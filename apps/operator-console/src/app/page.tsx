import { ActivityFeed } from '@/components/overview/activity-feed';
import { EquityCurve } from '@/components/overview/equity-curve';
import { OverviewKpiStrip } from '@/components/overview/kpi-strip';
import { SystemHealth } from '@/components/overview/system-health';
import { TopPerformers } from '@/components/overview/top-performers';

export default function OverviewPage() {
  return (
    <div className="flex flex-col gap-4">
      <OverviewKpiStrip />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <EquityCurve />
        </div>
        <SystemHealth />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TopPerformers />
        <ActivityFeed />
      </div>
    </div>
  );
}
