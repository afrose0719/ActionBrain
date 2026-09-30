export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-5xl font-bold tracking-tight">ActionBrain</h1>
      <p className="text-xl text-gray-500">Never lose a commitment again.</p>
      <p className="rounded-full bg-green-100 px-4 py-1 text-sm text-green-800">
        Milestone 1 works ✅
      </p>
      <a href="/login" className="rounded bg-black px-5 py-2 text-white">
        Log in / Sign up
      </a>
    </main>
  );
}
