import { Hero } from '@/components/marketing/hero';
import { ProviderStrip } from '@/components/marketing/provider-strip';
import { Features } from '@/components/marketing/features';
import { HowItWorks } from '@/components/marketing/how-it-works';
import { Install } from '@/components/marketing/install';

export default function LandingPage() {
  return (
    <>
      <Hero />
      <ProviderStrip />
      <Features />
      <HowItWorks />
      <Install />
    </>
  );
}
