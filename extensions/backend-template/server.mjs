/** 独立后端扩展模板：固定租户服务账号，鉴权后读取宿主已授权观测；客户可仅替换read方法。 */
import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
const token=process.env.EXTENSION_ACCESS_TOKEN, tenant=process.env.EXTENSION_TENANT_ID, username=process.env.CORE_API_USERNAME, password=process.env.CORE_API_PASSWORD;
if(!token || token.length<32 || !tenant || !username || !password) throw Error("扩展服务认证或固定租户未配置");
const base=new URL(process.env.CORE_API_URL || "http://core-api:3001");
if(!["http:","https:"].includes(base.protocol)||base.username||base.password)throw Error("宿主地址无效");
const digest=(value)=>createHash("sha256").update(value).digest();
const validToken=(value)=>timingSafeEqual(digest(value??""),digest(`Bearer ${token}`));
let cookie="", active=0;
async function login(signal) {
 const response=await fetch(new URL("/api/auth/login",base),{method:"POST",headers:{"Content-Type":"application/json","X-DTV-Request":"1"},body:JSON.stringify({username,password}),redirect:"error",signal});
 if(!response.ok)throw Error("服务账号登录失败");const identity=await response.json();
 if(identity.user?.tenantId!==tenant)throw Error("服务账号租户不匹配");
 const issued=response.headers.get("set-cookie")?.split(";")[0];if(!issued?.startsWith("dtv_session="))throw Error("会话响应无效");cookie=issued;
}
async function read(scene,time,signal) {
 if(!cookie)await login(signal);
 const url=new URL(`/api/layers/temperature/data?${new URLSearchParams({sceneId:scene,time})}`,base);
 let response=await fetch(url,{headers:{Cookie:cookie},signal,redirect:"error"});
 if(response.status===401){cookie="";await login(signal);response=await fetch(url,{headers:{Cookie:cookie},signal,redirect:"error"});}
 if(!response.ok)throw Error("数据权限或产品读取失败");
 const frame=await response.json();
 return {source:frame.source,observedAt:frame.observedAt,unit:frame.unit,crs:frame.crs,observations:frame.observations};
}
const server=createServer(async(req,res)=>{
 const reply=(status,value)=>{res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});res.end(JSON.stringify(value));};
 const url=new URL(req.url??"/","http://extension");
 if(req.method==="GET" && url.pathname==="/health")return reply(200,{status:"ok",service:"customer-extension"});
 if(req.method!=="GET" || url.pathname!=="/observations")return reply(404,{message:"接口不存在"});
 if(!validToken(req.headers.authorization)||req.headers["x-dtv-tenant"]!==tenant)return reply(403,{message:"扩展服务无权访问"});
 const scene=url.searchParams.get("sceneId")??"",time=url.searchParams.get("time")??"";
 if(!/^[a-z][a-z0-9-]{0,63}$/.test(scene)||!/^\d{4}-\d\d-\d\dT\d\d:00:00(?:Z|[+-]\d\d:\d\d)$/.test(time)||!Number.isFinite(Date.parse(time)))return reply(400,{message:"地区或时次格式无效"});
 if(active>=4)return reply(429,{message:"服务繁忙"});
 active++;
 try {reply(200,await read(scene,time,AbortSignal.timeout(10000)));}catch {reply(502,{message:"扩展服务读取失败，请检查服务账号授权与连接配置"});}finally{active--;}
});
server.listen(Number(process.env.PORT??3100),process.env.HOST??"0.0.0.0",()=>console.log("客户扩展服务已启动（未输出凭据）"));
process.on("SIGTERM",()=>server.close());process.on("SIGINT",()=>server.close());
