import { createClient } from '@supabase/supabase-js';
const url=import.meta.env.VITE_SUPABASE_URL,key=import.meta.env.VITE_SUPABASE_ANON_KEY;
export const cloud=url&&key?createClient(url,key):null;
export async function aiFetch(path:string,options:RequestInit={}) {
  const headers=new Headers(options.headers);
  if(cloud){const {data}=await cloud.auth.getSession();if(data.session)headers.set('Authorization',`Bearer ${data.session.access_token}`);}
  let response:Response;
  try{response=await fetch(path,{...options,headers,signal:AbortSignal.timeout(240000)});}catch{throw new Error('Não foi possível acessar o serviço de IA. Confira a conexão e a configuração do servidor.');}
  const contentType=response.headers.get('content-type')??'';
  if(!contentType.includes('application/json'))throw new Error('O serviço de IA ainda não está disponível. Configure o servidor para ativar este recurso.');
  const data=await response.json();if(!response.ok)throw new Error(data.error??'O serviço de IA não conseguiu concluir a solicitação.');return data;
}
