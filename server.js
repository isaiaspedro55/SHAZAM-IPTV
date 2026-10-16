const http=require('http');
const { Server }=require('socket.io');
const express=require('express');
const cors=require('cors');
const dotenv=require('dotenv');
const fs=require('fs');
const path=require('path');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const crypto=require('crypto');
const { Pool } = require('pg');

dotenv.config();

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    })
  : null;

const app=express();
const httpServer=http.createServer(app);
const io=new Server(httpServer,{
  cors:{origin:true},
  maxHttpBufferSize:1e6
});
const PORT=process.env.PORT||3000;
const JWT_SECRET=process.env.JWT_SECRET;
const ADMIN_USERNAME=String(process.env.ADMIN_USERNAME||'').trim();

if(!JWT_SECRET||JWT_SECRET.length<32){
console.error('❌ JWT_SECRET precisa ter pelo menos 32 caracteres.');
process.exit(1);
}

const DATA_DIR=path.join(__dirname,'data');
const USERS_FILE=path.join(DATA_DIR,'users.json');

if(!fs.existsSync(DATA_DIR))fs.mkdirSync(DATA_DIR,{recursive:true});
if(!fs.existsSync(USERS_FILE))fs.writeFileSync(USERS_FILE,JSON.stringify({users:[]},null,2));

app.use(cors());
app.use(express.json({limit:'10kb'}));
app.use(express.static(__dirname));

io.use(async (socket, next) => {
  try {
    const token = String(socket.handshake.auth?.token || '').trim();

    if (!token) {
      return next(new Error('Autenticação necessária.'));
    }

    const payload = jwt.verify(token, JWT_SECRET);
    const user = await buscarUsuarioPorId(payload.id);

    if (!user || !contaValida(user)) {
      return next(new Error('Conta inválida ou expirada.'));
    }

    socket.user = {
      id: user.id,
      username: user.username
    };

    next();
  } catch (err) {
    next(new Error('Token inválido ou sessão expirada.'));
  }
});


io.on('connection', (socket) => {
  const ehProprietario =
    Boolean(ADMIN_USERNAME) &&
    socket.user.username === ADMIN_USERNAME;


  // Disponibiliza ao cliente a identidade autenticada pelo servidor.
  if (ehProprietario) socket.join('chat:owners');

  socket.on('chat:identidade', (ack) => {
    if (typeof ack === 'function') {
      ack({ ok: true, username: socket.user.username });
    }
  });

  // Os sockets autenticados recebem anúncios globais.
  socket.join('global:announcements');

  socket.on('chat:global:listar', async (ack) => {
    try {
      if (!pool) {
        throw new Error('PostgreSQL não está disponível.');
      }

      const resultado = await pool.query(
        `SELECT a.id, a.message, a.created_at,
                replace(encode(a.image_data, 'base64'), E'\\n', '') AS image_data_base64,
                a.image_mime,
                u.username AS sender
         FROM global_announcements a
         JOIN users u ON u.id = a.sender_user_id
         ORDER BY a.created_at DESC
         LIMIT 100`
      );

      if (typeof ack === 'function') {
        ack({ ok: true, announcements: resultado.rows.reverse() });
      }
    } catch (err) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: err.message });
      }
    }
  });

  socket.on('chat:global:enviar', async (dados, ack) => {
    try {
      if (!ehProprietario) {
        throw new Error('Apenas o proprietário pode enviar anúncios globais.');
      }

      if (!pool) {
        throw new Error('PostgreSQL não está disponível.');
      }

      let mensagem = String(dados?.message || '').trim();
      const imageBase64 = typeof dados?.imageBase64 === 'string'
        ? dados.imageBase64 : '';
      const imageMime = String(dados?.imageMime || '');
      let imageBuffer = null;

      if (imageBase64) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(imageMime)) {
          throw new Error('Formato de fotografia não permitido.');
        }

        if (
          imageBase64.length > 820000 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64) ||
          imageBase64.length % 4 !== 0
        ) {
          throw new Error('Fotografia inválida ou demasiado grande.');
        }

        imageBuffer = Buffer.from(imageBase64, 'base64');

        if (
          imageBuffer.length === 0 ||
          imageBuffer.length > 600 * 1024 ||
          imageBuffer.toString('base64') !== imageBase64
        ) {
          throw new Error('A fotografia deve ter no máximo 600 KB.');
        }
      } else if (imageMime) {
        throw new Error('Não foi recebida nenhuma fotografia.');
      }

      if (!mensagem && imageBuffer) {
        mensagem = '📷 Fotografia';
      }

      if (!mensagem || mensagem.length > 2000) {
        throw new Error('A mensagem deve ter entre 1 e 2000 caracteres.');
      }

      const inserida = await pool.query(
        `INSERT INTO global_announcements
           (sender_user_id, message, image_data, image_mime)
         VALUES ($1, $2, $3, $4)
         RETURNING id, message, created_at,
                   replace(encode(image_data, 'base64'), E'\\n', '') AS image_data_base64,
                   image_mime`,
        [
          socket.user.id,
          mensagem,
          imageBuffer,
          imageBuffer ? imageMime : null
        ]
      );

      const anuncio = {
        ...inserida.rows[0],
        sender: socket.user.username
      };

      io.to('global:announcements').emit(
        'chat:global:nova',
        anuncio
      );

      if (typeof ack === 'function') {
        ack({ ok: true, announcement: anuncio });
      }
    } catch (err) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: err.message });
      }
    }
  });

  socket.on('chat:abrir', async (ack) => {
    try {
      if (!pool) {
        throw new Error('O chat requer a base de dados PostgreSQL.');
      }

      if (ehProprietario) {
        throw new Error('O proprietário deve selecionar uma conversa.');
      }

      let resultado = await pool.query(
        `SELECT id, status
         FROM support_conversations
         WHERE user_id = $1 AND status = 'open'
         ORDER BY updated_at DESC
         LIMIT 1`,
        [socket.user.id]
      );

      let conversa = resultado.rows[0];

      if (!conversa) {
        resultado = await pool.query(
          `INSERT INTO support_conversations (user_id)
           VALUES ($1)
           RETURNING id, status`,
          [socket.user.id]
        );
        conversa = resultado.rows[0];
      }

      const sala = `support:${conversa.id}`;
      await socket.join(sala);

      const mensagens = await pool.query(
        `SELECT m.id, m.message, m.created_at,
                replace(encode(m.image_data, 'base64'), E'\\n', '') AS image_data_base64,
                m.image_mime, u.username AS sender
         FROM support_messages m
         JOIN users u ON u.id = m.sender_user_id
         WHERE m.conversation_id = $1
         ORDER BY m.created_at ASC
         LIMIT 200`,
        [conversa.id]
      );

      if (typeof ack === 'function') {
        ack({
          ok: true,
          conversationId: conversa.id,
          status: conversa.status,
          messages: mensagens.rows
        });
      }
    } catch (err) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: err.message });
      }
    }
  });

  socket.on('chat:admin:listar', async (ack) => {
    try {
      if (!ehProprietario) {
        throw new Error('Acesso reservado ao proprietário.');
      }
      if (!pool) {
        throw new Error('PostgreSQL não está disponível.');
      }

      const resultado = await pool.query(
        `SELECT c.id, c.user_id AS cliente_id,
                c.status, c.created_at, c.updated_at,
                u.username AS cliente,
                (SELECT COUNT(*) FROM support_messages m
                 WHERE m.conversation_id = c.id) AS total_mensagens,
                (SELECT COUNT(*) FROM support_messages m
                 WHERE m.conversation_id = c.id
                   AND m.sender_user_id = c.user_id
                   AND m.read_at IS NULL) AS mensagens_nao_lidas
         FROM support_conversations c
         JOIN users u ON u.id = c.user_id
         ORDER BY
           CASE WHEN c.status = 'open' THEN 0 ELSE 1 END,
           c.updated_at DESC
         LIMIT 200`
      );

      if (typeof ack === 'function') {
        ack({ ok: true, conversations: resultado.rows });
      }
    } catch (err) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: err.message });
      }
    }
  });

  socket.on('chat:entrar', async (dados, ack) => {
    try {
      if (!pool) {
        throw new Error('PostgreSQL não está disponível.');
      }

      const id = String(dados?.conversationId || '');
      if (!/^\d+$/.test(id)) {
        throw new Error('Identificador de conversa inválido.');
      }

      const resultado = await pool.query(
        `SELECT id, user_id, status
         FROM support_conversations
         WHERE id = $1`,
        [id]
      );

      const conversa = resultado.rows[0];

      if (!conversa) {
        throw new Error('Conversa não encontrada.');
      }

      if (!ehProprietario && conversa.user_id !== socket.user.id) {
        throw new Error('Não tens permissão para aceder a esta conversa.');
      }

      await socket.join(`support:${conversa.id}`);

      // Ao abrir uma conversa, marcar como vistas as mensagens do cliente.
      if (ehProprietario) {
        await pool.query(
          `UPDATE support_messages
           SET read_at = NOW()
           WHERE conversation_id = $1
             AND sender_user_id = $2
             AND read_at IS NULL`,
          [conversa.id, conversa.user_id]
        );
      }

      const mensagens = await pool.query(
        `SELECT m.id, m.message, m.created_at,
                replace(encode(m.image_data, 'base64'), E'\\n', '') AS image_data_base64,
                m.image_mime, u.username AS sender
         FROM support_messages m
         JOIN users u ON u.id = m.sender_user_id
         WHERE m.conversation_id = $1
         ORDER BY m.created_at ASC
         LIMIT 200`,
        [conversa.id]
      );

      if (typeof ack === 'function') {
        ack({
          ok: true,
          conversationId: conversa.id,
          status: conversa.status,
          messages: mensagens.rows
        });
      }
    } catch (err) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: err.message });
      }
    }
  });

  socket.on('chat:enviar', async (dados, ack) => {
    try {
      if (!pool) {
        throw new Error('PostgreSQL não está disponível.');
      }

      const id = String(dados?.conversationId || '');
      let mensagem = String(dados?.message || '').trim();
      const imageBase64 = typeof dados?.imageBase64 === 'string'
        ? dados.imageBase64 : '';
      const imageMime = String(dados?.imageMime || '');
      let imageBuffer = null;

      if (!/^\d+$/.test(id)) {
        throw new Error('Identificador de conversa inválido.');
      }

      if (imageBase64) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(imageMime)) {
          throw new Error('Formato de fotografia não permitido.');
        }

        if (
          imageBase64.length > 820000 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64) ||
          imageBase64.length % 4 !== 0
        ) {
          throw new Error('Fotografia inválida ou demasiado grande.');
        }

        imageBuffer = Buffer.from(imageBase64, 'base64');

        if (
          imageBuffer.length === 0 ||
          imageBuffer.length > 600 * 1024 ||
          imageBuffer.toString('base64') !== imageBase64
        ) {
          throw new Error('A fotografia deve ter no máximo 600 KB.');
        }
      } else if (imageMime) {
        throw new Error('Não foi recebida nenhuma fotografia.');
      }

      if (!mensagem && imageBuffer) {
        mensagem = '📷 Fotografia';
      }

      if (!mensagem || mensagem.length > 2000) {
        throw new Error('A mensagem deve ter entre 1 e 2000 caracteres.');
      }

      const resultado = await pool.query(
        `SELECT id, user_id, status
         FROM support_conversations
         WHERE id = $1`,
        [id]
      );

      const conversa = resultado.rows[0];

      if (!conversa) {
        throw new Error('Conversa não encontrada.');
      }
      if (!ehProprietario && conversa.user_id !== socket.user.id) {
        throw new Error('Não tens permissão para enviar mensagens nesta conversa.');
      }
      if (conversa.status !== 'open') {
        throw new Error('Esta conversa está fechada.');
      }

      const inserida = await pool.query(
        `INSERT INTO support_messages
           (conversation_id, sender_user_id, message, image_data, image_mime)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, message, created_at,
                   replace(encode(image_data, 'base64'), E'\\n', '') AS image_data_base64,
                   image_mime`,
        [
          conversa.id,
          socket.user.id,
          mensagem,
          imageBuffer,
          imageBuffer ? imageMime : null
        ]
      );

      await pool.query(
        `UPDATE support_conversations
         SET updated_at = NOW()
         WHERE id = $1`,
        [conversa.id]
      );

      const mensagemGuardada = {
        ...inserida.rows[0],
        conversationId: conversa.id,
        sender: socket.user.username
      };

      io.to(`support:${conversa.id}`).emit(
        'chat:nova-mensagem',
        mensagemGuardada
      );

      // Notificar o proprietário quando um cliente envia uma mensagem.
      if (!ehProprietario) {
        io.to('chat:owners').emit('chat:apoio:nova', {
          userId: conversa.user_id,
          conversationId: conversa.id
        });
      }

      if (typeof ack === 'function') {
        ack({ ok: true, message: mensagemGuardada });
      }
    } catch (err) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: err.message });
      }
    }
  });
});

function carregarUsuarios(){
try{return JSON.parse(fs.readFileSync(USERS_FILE,'utf8'));}catch{return {users:[]};}
}

function salvarUsuarios(data){
fs.writeFileSync(USERS_FILE,JSON.stringify(data,null,2));
}


function usuarioDoBanco(row){

if(!row)return null;

return{
id:row.id,
username:row.username,
passwordHash:row.password_hash,
status:row.status,
createdAt:new Date(row.created_at).toISOString(),
expiresAt:new Date(row.expires_at).toISOString(),
lastLogin:row.last_login?new Date(row.last_login).toISOString():null
};

}


async function buscarUsuario(username){

if(!pool){

const db=carregarUsuarios();

return db.users.find(
u=>u.username.toLowerCase()===String(username).toLowerCase()
)||null;

}

const resultado=await pool.query(
`SELECT * FROM users
 WHERE LOWER(username)=LOWER($1)
 LIMIT 1`,
[username]
);

return usuarioDoBanco(resultado.rows[0]);

}


async function buscarUsuarioPorId(id){

if(!pool){

const db=carregarUsuarios();

return db.users.find(u=>u.id===id)||null;

}

const resultado=await pool.query(
`SELECT * FROM users
 WHERE id=$1
 LIMIT 1`,
[id]
);

return usuarioDoBanco(resultado.rows[0]);

}


async function atualizarUltimoLogin(id,lastLogin){

if(!pool){

const db=carregarUsuarios();

const user=db.users.find(u=>u.id===id);

if(user){

user.lastLogin=lastLogin;

salvarUsuarios(db);

}

return;

}

await pool.query(
`UPDATE users
 SET last_login=$1
 WHERE id=$2`,
[lastLogin,id]
);

}


async function inserirUsuarioBanco(user){

if(!pool)return;

await pool.query(
`INSERT INTO users
(id,username,password_hash,status,created_at,expires_at,last_login)
VALUES($1,$2,$3,$4,$5,$6,$7)
ON CONFLICT DO NOTHING`,
[
user.id,
user.username,
user.passwordHash,
user.status,
user.createdAt,
user.expiresAt,
user.lastLogin
]
);

}


async function migrarUsuariosJsonParaBanco(){

if(!pool)return;

const db=carregarUsuarios();

if(!Array.isArray(db.users)||db.users.length===0){

console.log('ℹ️ Nenhum usuário no users.json para migrar.');

return;

}

let migrados=0;

for(const user of db.users){

try{

const resultado=await pool.query(
`INSERT INTO users
(id,username,password_hash,status,created_at,expires_at,last_login)
VALUES($1,$2,$3,$4,$5,$6,$7)
ON CONFLICT DO NOTHING`,
[
user.id,
user.username,
user.passwordHash,
user.status,
user.createdAt,
user.expiresAt,
user.lastLogin||null
]
);

if(resultado.rowCount>0)migrados++;

}catch(e){

console.error(
`❌ Erro ao migrar ${user.username}:`,
e.message
);

}

}

console.log(
`📦 Migração users.json → PostgreSQL concluída. Novos: ${migrados}.`
);

}


async function inicializarBanco(){

if(!pool){
console.log('ℹ️ DATABASE_URL não configurada. Usando users.json localmente.');
return;
}

await pool.query(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ativo',
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_login TIMESTAMPTZ
)
`);

await pool.query(`
CREATE TABLE IF NOT EXISTS support_conversations (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
`);

await pool.query(`
CREATE TABLE IF NOT EXISTS support_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL
    REFERENCES support_conversations(id) ON DELETE CASCADE,
  sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL
    CHECK (char_length(message) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
)
`);

await pool.query(`
ALTER TABLE support_messages
  ADD COLUMN IF NOT EXISTS image_data BYTEA,
  ADD COLUMN IF NOT EXISTS image_mime TEXT
`);

await pool.query(`
CREATE TABLE IF NOT EXISTS global_announcements (
  id BIGSERIAL PRIMARY KEY,
  sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL
    CHECK (char_length(message) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
`);

await pool.query(`
ALTER TABLE global_announcements
  ADD COLUMN IF NOT EXISTS image_data BYTEA,
  ADD COLUMN IF NOT EXISTS image_mime TEXT
`);

await pool.query(`
CREATE INDEX IF NOT EXISTS idx_support_conversations_user
ON support_conversations(user_id, updated_at DESC)
`);

await pool.query(`
CREATE INDEX IF NOT EXISTS idx_support_messages_conversation
ON support_messages(conversation_id, created_at ASC)
`);

console.log('✅ PostgreSQL conectado; utilizadores e tabelas do chat prontos.');
}

function contaValida(user){
if(!user||user.status!=='ativo')return false;
const exp=new Date(user.expiresAt).getTime();
return Number.isFinite(exp)&&exp>Date.now();
}

function duracaoParaMs(valor){
const m=String(valor).trim().toLowerCase().match(/^(\d+)(h|d)$/);

if(!m)return null;

const numero=Number(m[1]);
if(numero<=0)return null;

if(m[2]==='h')return numero*60*60*1000;
if(m[2]==='d')return numero*24*60*60*1000;

return null;
}

function gerarCodigo(tamanho=6){
return crypto.randomBytes(tamanho).toString('hex').toUpperCase().slice(0,10);
}

app.get('/api/status',(req,res)=>{
res.json({
ok:true,
service:'SHAZAM IPTV',
status:'online'
});
});

app.get('/api/server-time',(req,res)=>{
  const agora = new Date();

  res.json({
    ok: true,
    server: 'SHAZAM IPTV',
    isoUTC: agora.toISOString(),
    timestamp: agora.getTime(),
    local: agora.toString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezoneOffsetMinutes: agora.getTimezoneOffset()
  });
});


app.get('/api/admin/debug-user',async(req,res)=>{

try{

const adminKey=req.headers['x-admin-key'];

if(!adminKey||adminKey!==process.env.ADMIN_KEY){
return res.status(403).json({
ok:false,
error:'Não autorizado.'
});
}

const username=String(
req.query.username||''
).trim();

if(!username){
return res.status(400).json({
ok:false,
error:'Informe o username.'
});
}

const user=await buscarUsuario(username);

if(!user){
return res.status(404).json({
ok:false,
error:'Usuário não encontrado.'
});
}

const agora=new Date();
const criado=new Date(user.createdAt);
const expiracao=new Date(user.expiresAt);

const criadoMs=criado.getTime();
const expiracaoMs=expiracao.getTime();
const agoraMs=agora.getTime();

const duracaoMs=expiracaoMs-criadoMs;
const restanteMs=expiracaoMs-agoraMs;

res.json({

ok:true,

serverTime:{
isoUTC:agora.toISOString(),
timestamp:agoraMs,
local:agora.toString(),
timezone:Intl.DateTimeFormat().resolvedOptions().timeZone
},

user:{
username:user.username,
status:user.status,
createdAt:user.createdAt,
expiresAt:user.expiresAt,
lastLogin:user.lastLogin||null
},

calculo:{
duracaoMs,
duracaoHoras:duracaoMs/3600000,
restanteMs,
restanteHoras:restanteMs/3600000,
expirado:restanteMs<=0,
contaValida:contaValida(user)
}

});

}catch(e){

console.error('❌ Debug usuário:',e);

res.status(500).json({
ok:false,
error:'Erro interno do servidor.'
});

}

});


function apenasProprietario(req,res,next){
if(!ADMIN_USERNAME || req.user?.username !== ADMIN_USERNAME){
return res.status(403).json({
ok:false,
error:'Acesso reservado ao proprietário.'
});
}
next();
}

async function autenticar(req,res,next){

const auth=req.headers.authorization||'';

if(!auth.startsWith('Bearer ')){
return res.status(401).json({
ok:false,
error:'Não autenticado.'
});
}

const token=auth.slice(7);

try{

const payload=jwt.verify(
token,
JWT_SECRET
);

const user=await buscarUsuarioPorId(
payload.id
);

if(!user){
return res.status(401).json({
ok:false,
error:'Usuário não encontrado.'
});
}

if(!contaValida(user)){
return res.status(403).json({
ok:false,
error:'Acesso expirado ou revogado.'
});
}

req.user=user;

next();

}catch(e){

console.error('❌ Autenticação:',e.message);

return res.status(401).json({
ok:false,
error:'Sessão inválida ou expirada.'
});

}

}

app.post('/api/login',async(req,res)=>{
try{

const username=String(req.body?.username||'').trim();
const password=String(req.body?.password||'');

if(!username||!password){
return res.status(400).json({
ok:false,
error:'Usuário e senha são obrigatórios.'
});
}

const user=await buscarUsuario(username);

if(!user){
return res.status(401).json({
ok:false,
error:'Usuário ou senha inválidos.'
});
}

const senhaCorreta=await bcrypt.compare(
password,
user.passwordHash
);

if(!senhaCorreta){
return res.status(401).json({
ok:false,
error:'Usuário ou senha inválidos.'
});
}

if(!contaValida(user)){
return res.status(403).json({
ok:false,
error:'Acesso expirado ou revogado.'
});
}

const lastLogin=new Date().toISOString();

await atualizarUltimoLogin(
user.id,
lastLogin
);

const token=jwt.sign(
{
id:user.id,
username:user.username
},
JWT_SECRET,
{
expiresIn:'7d'
}
);

res.json({
ok:true,
token,
user:{
username:user.username,
expiresAt:user.expiresAt
}
});

}catch(e){

console.error('❌ Login:',e);

res.status(500).json({
ok:false,
error:'Erro interno do servidor.'
});

}

});

app.get('/api/me',autenticar,(req,res)=>{
res.json({
ok:true,
user:{
username:req.user.username,
expiresAt:req.user.expiresAt,
status:req.user.status
}
});
});

app.post('/api/logout',autenticar,(req,res)=>{
res.json({ok:true});
});

/*
  CRIAÇÃO DE USUÁRIO
  Será usada pelo BOT.
  Exemplo:
  POST /api/admin/create-user

  {
    "adminKey":"...",
    "duration":"3d"
  }
*/

app.post('/api/admin/create-user',async(req,res)=>{

try{

const adminKey=String(req.body?.adminKey||'');
const duration=String(req.body?.duration||'').trim().toLowerCase();

if(adminKey!==process.env.ADMIN_KEY){
return res.status(403).json({
ok:false,
error:'Não autorizado.'
});
}

const duracaoMs=duracaoParaMs(duration);

if(!duracaoMs){
return res.status(400).json({
ok:false,
error:'Duração inválida. Use, por exemplo: 1h, 12h, 1d, 3d ou 30d.'
});
}

let username;

do{

username='SHZ-'+gerarCodigo(8);

if(pool){

const existente=await pool.query(
`SELECT 1 FROM users WHERE username=$1 LIMIT 1`,
[username]
);

if(existente.rowCount===0)break;

}else{

const db=carregarUsuarios();

if(!db.users.some(
u=>u.username===username
))break;

}

}while(true);


const password=gerarCodigo(8);

const agora=new Date();
const expiracao=new Date(
agora.getTime()+duracaoMs
);

const passwordHash=await bcrypt.hash(
password,
12
);

const user={
id:crypto.randomUUID(),
username,
passwordHash,
status:'ativo',
createdAt:agora.toISOString(),
expiresAt:expiracao.toISOString(),
lastLogin:null
};


if(pool){

await inserirUsuarioBanco(user);

console.log(
`✅ Usuário ${username} criado no PostgreSQL.`
);

}else{

const db=carregarUsuarios();

db.users.push(user);

salvarUsuarios(db);

console.log(
`✅ Usuário ${username} criado no users.json.`
);

}


res.json({
ok:true,
user:{
username,
password,
duration,
createdAt:user.createdAt,
expiresAt:user.expiresAt
}
});

}catch(e){

console.error('❌ Criar usuário:',e);

res.status(500).json({
ok:false,
error:'Erro ao criar usuário.'
});

}

});




async function iniciarServidor(){

try{

await inicializarBanco();
await migrarUsuariosJsonParaBanco();


/* ========================================
   API EPG SHAZAM IPTV
======================================== */

const zlib = require('zlib');
const { XMLParser } = require('fast-xml-parser');

/* EPG_AUTO_DOWNLOAD_V1 */
const EPG_URL = process.env.EPG_URL ||
  'https://raw.githubusercontent.com/LITUATUI/M3UPT/main/EPG/epg-m3upt.xml.gz';

const EPG_LOCAL = path.join(__dirname, 'epg', 'epg-m3upt.xml.gz');
const EPG_FILE = fs.existsSync(EPG_LOCAL)
  ? EPG_LOCAL
  : path.join(require('os').tmpdir(), 'shazam-iptv-epg.xml.gz');

const EPG_INTERVALO = 6 * 60 * 60 * 1000;
let epgDownloadEmCurso = null;

async function atualizarFicheiroEPG() {
  if (epgDownloadEmCurso) return epgDownloadEmCurso;

  epgDownloadEmCurso = (async () => {
    const temporario = EPG_FILE + '.download';

    try {
      console.log('📥 A descarregar EPG...');

      const resposta = await fetch(EPG_URL, {
        signal: AbortSignal.timeout(90000)
      });

      if (!resposta.ok) {
        throw new Error('HTTP ' + resposta.status);
      }

      const buffer = Buffer.from(await resposta.arrayBuffer());

      if (
        buffer.length < 1000 ||
        buffer[0] !== 0x1f ||
        buffer[1] !== 0x8b
      ) {
        throw new Error('Ficheiro gzip inválido');
      }

      const xml = zlib.gunzipSync(buffer).toString('utf8');

      if (!/<tv(?:\s|>)/i.test(xml) ||
          !/<programme(?:\s|>)/i.test(xml)) {
        throw new Error('XMLTV inválido');
      }

      const teste = epgParser.parse(xml);

      if (!teste.tv || !teste.tv.programme) {
        throw new Error('O ficheiro não contém programas');
      }

      fs.mkdirSync(path.dirname(EPG_FILE), { recursive: true });
      fs.writeFileSync(temporario, buffer);
      fs.renameSync(temporario, EPG_FILE);

      epgCache = null;
      epgMtime = 0;

      console.log('✅ EPG atualizado:', (buffer.length / 1048576).toFixed(2), 'MB');
      return true;
    } catch (erro) {
      try {
        if (fs.existsSync(temporario)) fs.unlinkSync(temporario);
      } catch {}

      console.error('⚠️ Atualização EPG falhou:', erro.message);

      if (fs.existsSync(EPG_FILE)) {
        console.log('📺 Será mantido o EPG anterior.');
        return false;
      }

      throw erro;
    }
  })();

  try {
    return await epgDownloadEmCurso;
  } finally {
    epgDownloadEmCurso = null;
  }
}


const epgParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => ['channel', 'programme', 'title', 'sub-title', 'desc'].includes(name)
});

let epgCache = null;
let epgMtime = 0;

function carregarEPG() {
    if (!fs.existsSync(EPG_FILE)) {
        throw new Error('Ficheiro EPG não encontrado');
    }

    const stat = fs.statSync(EPG_FILE);

    if (epgCache && stat.mtimeMs === epgMtime) {
        return epgCache;
    }

    const xml = zlib.gunzipSync(fs.readFileSync(EPG_FILE)).toString('utf8');
    const parsed = epgParser.parse(xml);
    const tv = parsed.tv || {};
    const programas = Array.isArray(tv.programme)
        ? tv.programme
        : tv.programme ? [tv.programme] : [];

    const porCanal = new Map();

    for (const p of programas) {
        const canal = p['@_channel'];
        if (!canal) continue;

        if (!porCanal.has(canal)) porCanal.set(canal, []);

        const titleValue = p.title;
        const title = Array.isArray(titleValue)
            ? titleValue[0]
            : titleValue;

        porCanal.get(canal).push({
            title: typeof title === 'object'
                ? (title['#text'] || 'Título não disponível')
                : (title || 'Título não disponível'),
            start: p['@_start'],
            stop: p['@_stop'],
            description: Array.isArray(p.desc)
                ? (p.desc[0]?.['#text'] || p.desc[0] || '')
                : (p.desc?.['#text'] || p.desc || ''),
            subtitle: Array.isArray(p['sub-title'])
                ? (p['sub-title'][0]?.['#text'] || p['sub-title'][0] || '')
                : (p['sub-title']?.['#text'] || p['sub-title'] || '')
        });
    }

    for (const lista of porCanal.values()) {
        lista.sort((a, b) => a.start.localeCompare(b.start));
    }

    epgCache = porCanal;
    epgMtime = stat.mtimeMs;

    console.log(`📺 EPG carregado: ${programas.length} programas, ${porCanal.size} canais`);

    return epgCache;
}

function dataXMLTV(valor) {
    if (!valor) return NaN;

    const m = valor.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/);
    if (!m) return NaN;

    const [, ano, mes, dia, hora, minuto, segundo = '00', zona = '+0000'] = m;
    const sinal = zona[0] === '-' ? -1 : 1;
    const offset = (Number(zona.slice(1, 3)) * 60 + Number(zona.slice(3, 5))) * sinal;

    return Date.UTC(+ano, +mes - 1, +dia, +hora, +minuto, +segundo) - offset * 60000;
}

app.get('/api/epg/:tvgId', async (req, res) => {
    try {
        const tvgId = req.params.tvgId;

        if (!/^[\w.-]{1,120}$/.test(tvgId)) {
            return res.status(400).json({ ok: false, error: 'Identificador inválido' });
        }

        if (!fs.existsSync(EPG_FILE)) {
            await atualizarFicheiroEPG();
        }

        const epg = carregarEPG();
        const lista = epg.get(tvgId) || [];
        const agora = Date.now();

        const atual = lista.find(p =>
            dataXMLTV(p.start) <= agora && agora < dataXMLTV(p.stop)
        );

        const proximo = lista.find(p => dataXMLTV(p.start) > agora);

        function formatar(p) {
            if (!p) return null;

            return {
                title: p.title,
                start: new Date(dataXMLTV(p.start)).toISOString(),
                stop: new Date(dataXMLTV(p.stop)).toISOString(),
                description: p.description,
                subtitle: p.subtitle
            };
        }

        res.set('Cache-Control', 'public, max-age=60');
        return res.json({
            ok: true,
            channel: tvgId,
            current: formatar(atual),
            next: formatar(proximo)
        });
    } catch (err) {
        console.error('Erro na API EPG:', err.message);
        return res.status(503).json({
            ok: false,
            error: 'Programação temporariamente indisponível'
        });
    }
});


app.use((req,res)=>{
res.sendFile(path.join(__dirname,'index.html'));
});

/* EPG_AUTO_REFRESH_V2 */
setInterval(async () => {
    try {
        await atualizarFicheiroEPG();
    } catch (erro) {
        console.error('⚠️ Atualização periódica do EPG falhou:', erro.message);
    }
}, EPG_INTERVALO).unref();

httpServer.listen(PORT,'0.0.0.0',()=>{
console.log('');
console.log('⚡ SHAZAM IPTV');
console.log(`🌐 Servidor ativo na porta ${PORT}`);
console.log(`📺 http://localhost:${PORT}`);
console.log('');
});

}catch(e){

console.error('❌ Erro ao iniciar PostgreSQL:',e);
process.exit(1);

}

}


iniciarServidor();
