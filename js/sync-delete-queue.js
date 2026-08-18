export async function processPendingDeletions(pending, deleteOne) {
  const remaining = [];
  let firstError = null;

  for (const id of pending) {
    try {
      await deleteOne(id);
    } catch (error) {
      remaining.push(id);
      if (!firstError) {
        firstError = error instanceof Error ? error : new Error(String(error || 'Falha ao excluir inspeção remota.'));
      }
    }
  }

  return { remaining, firstError };
}
