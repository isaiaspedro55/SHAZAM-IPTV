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
const PORT=process.env.PORT||3000;
const JWT_SECRET=process.env.JWT_SECRET;

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

console.log('✅ PostgreSQL conectado e tabela users pronta.');
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


app.use((req,res)=>{
res.sendFile(path.join(__dirname,'index.html'));
});

async function iniciarServidor(){

try{

await inicializarBanco();
await migrarUsuariosJsonParaBanco();

app.listen(PORT,'0.0.0.0',()=>{
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
