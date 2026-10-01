"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

export default function DashboardPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [taskCount, setTaskCount] = useState<number | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return router.push("/login");
      setEmail(data.user.email ?? "");
      // Proves the database + Row Level Security work: counts only YOUR tasks.
      const { count } = await supabase
        .from("tasks")
        .select("*", { count: "exact", head: true });
      setTaskCount(count ?? 0);
    })();
  }, [router]);

  async function logOut() {
    await createClient().auth.signOut();
    router.push("/login");
  }

  if (email === null) return <p className="p-8">Loading...</p>;

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-bold">Dashboard</h1>
      <p className="mt-2 text-gray-600">Signed in as {email}</p>
      <p className="mt-4">
        You have <strong>{taskCount}</strong> tasks.
      </p>
      <div className="mt-6 flex gap-3">
        <a href="/tasks" className="rounded bg-black px-3 py-1 text-white">
          Go to Tasks
        </a>
        <button className="rounded border px-3 py-1" onClick={logOut}>
          Log out
        </button>
      </div>
    </main>
  );
}
