export type Setup = { preferred_name:string; preferred_currency:string; account_id:string; account_name:string; currency_code:string; opening_balance_minor:number };
let worker: Worker | undefined;
let sequence = 0;
const pending = new Map<number, {resolve:(value:any)=>void; reject:(error:Error)=>void}>();
/**
 * Send a serialized storage operation. Reject with the worker's storage or validation error.
 * @param command - Internal state, complete, or close operation.
 * @param args - Completion fields when saving setup; omitted for reads and close.
 * @returns Saved setup, or null before setup and after close.
 * The module owns the worker; callers must surface failures and explicitly close before retrying.
 */
export function database(command:string,args:object={}):Promise<Setup|null> {
 if(!worker) {
  worker=new Worker('/db-worker.js',{type:'module'});
  worker.onmessage=({data})=>{const call=pending.get(data.id); pending.delete(data.id); if(data.error) call?.reject(Error(data.error)); else call?.resolve(data.result);};
  worker.onerror=()=>{for(const call of pending.values()) call.reject(Error('Database worker failed. Reload Kuwi to retry; existing storage is preserved.')); pending.clear(); worker?.terminate(); worker=undefined;};
 }
 return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});worker!.postMessage({id,command,args});});
}
/** Close files and release ownership before allowing a new worker to retry startup. */
export async function closeDatabase() { if(worker) {try {await database('close');} finally {worker.terminate();worker=undefined;} } }
