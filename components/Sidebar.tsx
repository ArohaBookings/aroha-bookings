import Link from "next/link";

const Sidebar = () => {
  return (
    <aside className="w-60 h-screen bg-gray-900 text-white flex flex-col p-4">
      <h1 className="text-xl font-bold mb-6">Aroha Bookings</h1>
      <nav className="space-y-3">
        <Link href="/dashboard" className="block hover:text-teal-400">Dashboard</Link>
        <Link href="/calendar" className="block hover:text-teal-400">Calendar</Link>
        <Link href="/clients" className="block hover:text-teal-400">Clients</Link>
        <Link href="/settings" className="block hover:text-teal-400">Settings</Link>
      </nav>
    </aside>
  );
};

export default Sidebar;