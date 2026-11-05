import type { Context } from "../cli.js";
export function show(ctx: Context) {
  const [submission] = ctx.store.select({ id: ctx.args[0] });
  const checks = ctx.store.checks.filter(c => c.submissionId === submission.id).reverse()
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 5);
  return { submission, checks };
}
