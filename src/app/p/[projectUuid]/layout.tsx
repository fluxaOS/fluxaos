import { ConfirmModalHost } from '@/components/confirm-modal';
import { Nav } from '@/components/nav';
import { TRPCProvider } from '@/lib/trpc/provider';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // ConfirmModalHost (FLX-226) is mounted inside <TRPCProvider> so it
  // shares the same `'use client'` boundary as every form below it.
  // The module-level state in ConfirmModal.tsx wires up correctly only
  // when the host and caller are on the same client island.
  return (
    <TRPCProvider>
      <div className="flex h-full min-h-screen relative z-1">
        <Nav />
        <main className="flex-1 p-6 lg:p-8 overflow-y-auto">
          <div className="max-w-[1280px]">{children}</div>
        </main>
      </div>
      <ConfirmModalHost />
    </TRPCProvider>
  );
}
