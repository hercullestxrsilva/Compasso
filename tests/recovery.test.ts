import 'fake-indexeddb/auto';
import { afterEach,describe,expect,it } from 'vitest';
import { db,removePiece } from '../src/db';
import { clearCapture,recoverCapture } from '../src/components/Recorder';
afterEach(async()=>{await Promise.all(db.tables.map(t=>t.clear()));});
describe('recording and relation recovery',()=>{
  it('reassembles stored chunks in capture order',async()=>{await db.captures.put({id:'capture',title:'teste',mime:'audio/webm',createdAt:'2026-09-26'});await db.captureChunks.bulkPut([{id:'second',captureId:'capture',index:1,blob:new Blob(['B'])},{id:'first',captureId:'capture',index:0,blob:new Blob(['A'])}]);expect(await(await recoverCapture('capture')).text()).toBe('AB');await clearCapture('capture');expect(await db.captureChunks.count()).toBe(0);});
  it('does not erase lesson notes when deleting a related piece',async()=>{await db.pieces.put({id:'piece',title:'Teste',composer:'',status:'studying',tags:'',createdAt:'2026-09-26',updatedAt:'2026-09-26'});await db.notes.bulkPut([{id:'lesson-note',pieceId:'piece',lessonId:'lesson',text:'Keep this lesson note',source:'mine',createdAt:'2026-09-26'},{id:'piece-note',pieceId:'piece',text:'Piece note',source:'mine',createdAt:'2026-09-26'}]);await removePiece('piece');expect((await db.notes.get('lesson-note'))?.text).toBe('Keep this lesson note');expect((await db.notes.get('lesson-note'))?.pieceId).toBeUndefined();expect(await db.notes.get('piece-note')).toBeUndefined();});
});
