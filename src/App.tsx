import { Component, useState, type ReactNode } from 'react';
import { useStore } from '@/services/store';
import { Header, MobileNav } from '@/components/Header';
import { ScenarioBar } from '@/components/ScenarioBar';
import { Button, Notice } from '@/components/ui';
import { OperationsPage } from '@/pages/OperationsPage';
import { FinancialsPage } from '@/pages/FinancialsPage';
import { BusinessPage } from '@/pages/BusinessPage';
import { OptimizePage } from '@/pages/OptimizePage';
import { CompanyGuidePage } from '@/pages/CompanyGuidePage';
import { ClientReviewPage } from '@/pages/ClientReviewPage';
import { SavedReviews } from '@/components/SavedReviews';
import { clearPersisted } from '@/services/persistence';

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-xl p-6">
          <Notice tone="error">
            <div className="font-medium">Something went wrong showing this view.</div>
            <div className="mt-1">{this.state.error.message}</div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => this.setState({ error: null })}>
                Try again
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  clearPersisted();
                  window.location.reload();
                }}
              >
                Reset current session and reload
              </Button>
            </div>
          </Notice>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const companyKey = useStore((s) => [s.companySource, s.demoScenarioId, s.company.name].join(':'));
  const [overlay, setOverlay] = useState<'company-guide' | 'client-review' | null>(null);
  const closeGuide = () => setOverlay(null);
  const openFinancials = () => { setView('financials'); closeGuide(); };
  return (
    <div className="min-h-screen pb-20 md:pb-8">
      <div className="no-print xl:sticky xl:top-0 xl:z-30 xl:shadow-[0_1px_0_var(--color-line)]">
        <Header
          guideOpen={overlay !== null} openGuide={() => setOverlay('company-guide')} closeGuide={closeGuide}
          reviewControls={<>
            <Button size="sm" variant="primary" onClick={() => setOverlay('client-review')}>Review a client</Button>
            <SavedReviews onOpened={closeGuide} />
          </>}
        />
        {!overlay && <ScenarioBar />}
      </div>
      <main className="mx-auto max-w-[1500px] px-4 py-4 md:px-6 md:py-5">
        <Boundary>
          {overlay === 'client-review' ? <ClientReviewPage key={companyKey} onBack={closeGuide} onFinancials={openFinancials} />
            : overlay === 'company-guide' ? <CompanyGuidePage onBack={closeGuide} /> : (
            <>
              {view === 'operations' && <OperationsPage />}
              {view === 'financials' && <FinancialsPage />}
              {view === 'business' && <BusinessPage />}
              {view === 'optimize' && <OptimizePage />}
            </>
          )}
        </Boundary>
      </main>
      <MobileNav guideOpen={overlay !== null} closeGuide={closeGuide} />
    </div>
  );
}
