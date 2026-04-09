import { Nav } from '@/components/nav';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-screen relative z-1">
      <Nav />
      <main className="flex-1 p-6 lg:p-8 overflow-y-auto">
        <div className="max-w-[1280px]">
          {children}
        </div>
      </main>
    </div>
  );
}
