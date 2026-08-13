# Field readiness test plan — safe list refresh

Manual acceptance flow for the inspection-list refresh feature:

1. Create/import an inspection with at least four PW documents.
2. Review one document as Conforme or Não conforme and attach a photographic evidence when possible.
3. Mark a second document as Não encontrado.
4. Leave a third document pending.
5. Prepare a replacement spreadsheet where:
   - the first reviewed PW still exists but description/status/expected revision change;
   - the second reviewed PW is removed;
   - the pending third PW is removed;
   - a fourth/new PW is added.
6. Use **Atualizar lista** from the inspection card.
7. Confirm the comparison preview reports preserved reviewed documents, new documents, pending removals and retained reviewed documents.
8. Apply the refresh.
9. Verify:
   - reviewed PW keeps its copies, comments, evidence references and document identity;
   - observed revision remains unchanged;
   - catalog fields update from the new spreadsheet;
   - conformity is recalculated if expected revision changed;
   - reviewed PW missing from the new spreadsheet is still present;
   - pending PW missing from the new spreadsheet is removed;
   - new PW appears as Pendente.
10. Reload the page and repeat the checks.
11. When Supabase sync is configured, synchronize another device and confirm the same resulting inspection is received.
12. Repeat once while another tab changes the same inspection before the final confirmation; the update must rebase once instead of overwriting the newer field data.
