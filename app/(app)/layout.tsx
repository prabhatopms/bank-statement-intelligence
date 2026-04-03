export const dynamic = 'force-dynamic';

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import Link from 'next/link';
import { FileText, BarChart2, Settings, CreditCard, TrendingUp } from 'lucide-react';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-8">
              <div className="flex items-center gap-2">
                <CreditCard className="h-6 w-6 text-blue-600" />
                <span className="font-bold text-lg text-gray-900">BankIQ</span>
              </div>
              <div className="flex gap-6">
                <Link href="/documents" className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
                  <FileText className="h-4 w-4" />
                  Documents
                </Link>
                <Link href="/transactions" className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
                  <BarChart2 className="h-4 w-4" />
                  Transactions
                </Link>
                <Link href="/investments" className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
                  <TrendingUp className="h-4 w-4" />
                  Investments
                </Link>
                <Link href="/settings" className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
                  <Settings className="h-4 w-4" />
                  Settings
                </Link>
              </div>
            </div>
            <UserButton afterSignOutUrl="/sign-in" />
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
