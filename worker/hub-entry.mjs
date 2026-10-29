import { WorkerEntrypoint } from 'cloudflare:workers';
import worker, { appMcp } from './index.js';
import {readOwnerDashboard} from './owner-control.mjs';
export default worker;
// App-owned adapter: the Hub relays; all business logic and auth stay in GO's
// existing Factory/Observatory/GOVIEW adapters. This entrypoint is never public.
export class AppTools extends WorkerEntrypoint {
 fetch(request){return appMcp(request,this.env);}
 ownerStatus(){return readOwnerDashboard(this.env);}
}

