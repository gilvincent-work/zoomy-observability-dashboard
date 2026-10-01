import type {PosOrder} from '../../pos-sales-types';
import {readPosOrders, type ReadClient} from '../../pos-orders-read';
import {relationsForMode, type ChatReadMode} from './relations';

/** Orders for chat: mode-specific relations, customer-level columns never requested. */
export function readChatOrders(client: ReadClient, mode: ChatReadMode): Promise<PosOrder[]> {
  const {tables, columns} = relationsForMode(mode);
  return readPosOrders(client, {tables, columns});
}
