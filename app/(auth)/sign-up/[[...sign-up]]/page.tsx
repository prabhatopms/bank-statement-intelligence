import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Bank Statement Intelligence</h1>
        <p className="text-gray-600 mt-2">Create your account to get started</p>
      </div>
      <SignUp />
    </div>
  );
}
