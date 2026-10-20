import 'server-only';
import type {AccessResult} from '../auth/access.ts';
import type {Database} from '../supabase/database.types';

type StoredFlightOwner=Pick<Database['public']['Tables']['flights']['Row'],'owner_id'>;

/** Pass fresh getAccess() output and a server-loaded owner, never form/JWT claims.
 * This predicate does not load a flight, grant writes or waive lifecycle checks. */
export function canEditFlight(access:AccessResult,flight:StoredFlightOwner|null):boolean {
  return access.status==='authorized'&&flight!==null&&flight.owner_id===access.member.userId;
}
