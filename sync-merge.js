import {ConflictError} from './sync.js?v=0.1.6';

// A network request can finish after newer pulls have already been saved locally.
// Never replace those pulls with the request's older snapshot.
export function mergeSyncResult(snapshot,current,result){
  if(current.remoteKey!==snapshot.remoteKey)return null; // connection switched while request was running
  if(current.data.revision===snapshot.data.revision)return result;
  if(result.data.revision!==snapshot.data.revision){
    throw new ConflictError({sha:result.baseSha,data:result.data});
  }
  return {...current,baseSha:result.baseSha,dirty:true,lastSync:result.lastSync};
}
