import { Card, Notice } from '@/components/ui';

export function OptimizePage() {
  return (
    <div className="mx-auto max-w-2xl">
      <Card title="Optimize" subtitle="Ranked recommendations for what to change first.">
        <Notice>
          <div className="font-medium text-ink">Optimizer arrives in the next build.</div>
          <p className="mt-1">
            This view will rank bottlenecks and candidate changes by their effect on net profit or ending cash, with ranges across
            random conditions, and let you apply a recommendation to the draft. Until then, make changes in the Business view and
            watch the scenario bar above.
          </p>
        </Notice>
      </Card>
    </div>
  );
}
