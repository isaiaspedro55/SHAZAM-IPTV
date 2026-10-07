const express=require('express');
const cors=require('cors');
const dotenv=require('dotenv');
const fs=require('fs');
const path=require('path');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const crypto=require('crypto');

dotenv.config();

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


app.get('/api/admin/debug-user',(req,res)=>{
try{

const adminKey=req.headers['x-admin-key'];

if(!adminKey||adminKey!==process.env.ADMIN_KEY){
return res.status(403).json({
ok:false,
error:'Não autorizado.'
});
}

const username=String(req.query.username||'').trim();

if(!username){
return res.status(400).json({
ok:false,
error:'Informe o username.'
});
}

const db=carregarUsuarios();

const user=db.users.find(
u=>u.username.toLowerCase()===username.toLowerCase()
);

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

const db=carregarUsuarios();

const user=db.users.find(
u=>u.username.toLowerCase()===username.toLowerCase()
);

if(!user){
return res.status(401).json({
ok:false,
error:'Usuário ou senha inválidos.'
});
}

const senhaCorreta=await bcrypt.compare(password,user.passwordHash);

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

user.lastLogin=new Date().toISOString();
salvarUsuarios(db);

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

function autenticar(req,res,next){

const auth=req.headers.authorization||'';

if(!auth.startsWith('Bearer ')){
return res.status(401).json({
ok:false,
error:'Não autenticado.'
});
}

const token=auth.slice(7);

try{

const payload=jwt.verify(token,JWT_SECRET);
const db=carregarUsuarios();

const user=db.users.find(u=>u.id===payload.id);

if(!contaValida(user)){
return res.status(403).json({
ok:false,
error:'Acesso expirado ou revogado.'
});
}

req.user=user;
next();

}catch{

return res.status(401).json({
ok:false,
error:'Sessão inválida ou expirada.'
});

}
}

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

const db=carregarUsuarios();

let username;

do{
username='SHZ-'+gerarCodigo(8);
}while(db.users.some(u=>u.username===username));

let password;

do{
password=gerarCodigo(8);
}while(db.users.some(u=>u.passwordHash===password));

const agora=new Date();
const expiracao=new Date(agora.getTime()+duracaoMs);

const passwordHash=await bcrypt.hash(password,12);

const user={
id:crypto.randomUUID(),
username,
passwordHash,
status:'ativo',
createdAt:agora.toISOString(),
expiresAt:expiracao.toISOString(),
lastLogin:null
};

db.users.push(user);
salvarUsuarios(db);

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

app.listen(PORT,'0.0.0.0',()=>{
console.log('');
console.log('⚡ SHAZAM IPTV');
console.log(`🌐 Servidor ativo na porta ${PORT}`);
console.log(`📺 http://localhost:${PORT}`);
console.log('');
});
