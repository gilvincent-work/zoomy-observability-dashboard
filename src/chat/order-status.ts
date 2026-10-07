// The one definition of a completed order for the chat registry: status = 'completed', the same predicate as the
// pos_orders_completed view (supabase/coop_chat_default_views.sql). A null or unknown status is not completed.
export const isCompletedOrder = (o: {status: string}): boolean => o.status === 'completed';
