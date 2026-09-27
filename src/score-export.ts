import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import type { Asset, Annotation } from './domain';
export async function exportAnnotated(asset: Asset, annotations: Annotation[]) {
  const bytes=await asset.blob.arrayBuffer();
  let pdf: PDFDocument;
  if(asset.mime==='application/pdf'||asset.name.endsWith('.pdf')) pdf=await PDFDocument.load(bytes);
  else {
    pdf=await PDFDocument.create();
    let source=bytes;
    if(asset.mime!=='image/png'&&asset.mime!=='image/jpeg') {
      const bitmap=await createImageBitmap(asset.blob), canvas=document.createElement('canvas'); canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d')!.drawImage(bitmap,0,0);bitmap.close();
      source=await (await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Não foi possível converter a imagem.')),'image/png'))).arrayBuffer();
    }
    const image=asset.mime==='image/jpeg'?await pdf.embedJpg(source):await pdf.embedPng(source);const page=pdf.addPage([image.width,image.height]);page.drawImage(image,{x:0,y:0,width:image.width,height:image.height});
  }
  const font=await pdf.embedFont(StandardFonts.Helvetica);
  for(const a of annotations) {
    const page=pdf.getPage(a.page-1);if(!page)continue;const {width:w,height:h}=page.getSize();const rotation=((page.getRotation().angle%360)+360)%360;
    const vw=rotation===90||rotation===270?h:w, vh=rotation===90||rotation===270?w:h;
    const map=(p:{x:number;y:number})=>rotation===90?{x:p.y*w,y:p.x*h}:rotation===180?{x:(1-p.x)*w,y:p.y*h}:rotation===270?{x:(1-p.y)*w,y:(1-p.x)*h}:{x:p.x*vw,y:(1-p.y)*vh};
    const hex=a.color.replace('#','');const color=rgb(parseInt(hex.slice(0,2),16)/255,parseInt(hex.slice(2,4),16)/255,parseInt(hex.slice(4,6),16)/255);
    if(a.kind==='text') { const position=map(a.points[0]);let text=a.text??'';try{font.encodeText(text);}catch{ text=text.replace(/[^\x20-\x7E\xA0-\xFF]/g,'?'); }page.drawText(text,{...position,size:(a.fontSize??20)*vw/1000,font,color,rotate:degrees(rotation)}); }
    else for(let i=1;i<a.points.length;i++)page.drawLine({start:map(a.points[i-1]),end:map(a.points[i]),thickness:a.width*vw/1000,color,opacity:a.kind==='highlight'?.3:1});
  }
  return new Blob([new Uint8Array(await pdf.save())],{type:'application/pdf'});
}
