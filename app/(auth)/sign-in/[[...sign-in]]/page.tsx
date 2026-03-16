import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Bank Statement Intelligence</h1>
          <p className="text-gray-600 mt-2">Sign in to manage your bank statements</p>
        </div>
        <SignIn />
      </div>
    </div>
  );
}
