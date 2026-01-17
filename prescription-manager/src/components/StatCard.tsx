'use client';

interface StatCardProps {
  title: string;
  value: number;
  icon: 'clock' | 'flask' | 'check' | 'chart';
  color?: 'yellow' | 'purple' | 'green' | 'blue';
  onClick?: () => void;
  active?: boolean;
}

export default function StatCard({ title, value, icon, color = 'blue', onClick, active = false }: StatCardProps) {
  const iconMap = {
    clock: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    flask: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
      </svg>
    ),
    check: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    chart: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  };

  const colorMap = {
    yellow: 'text-yellow-500',
    purple: 'text-purple-500',
    green: 'text-green-500',
    blue: 'text-blue-500',
  };

  const activeColorMap = {
    yellow: 'ring-2 ring-yellow-400 bg-yellow-50',
    purple: 'ring-2 ring-purple-400 bg-purple-50',
    green: 'ring-2 ring-green-400 bg-green-50',
    blue: 'ring-2 ring-blue-400 bg-blue-50',
  };

  return (
    <div 
      className={`stat-card cursor-pointer transition-all ${active ? activeColorMap[color] : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-4">
        <span className={`text-sm ${active ? 'font-medium text-gray-700' : 'text-gray-500'}`}>{title}</span>
        <span className={colorMap[color]}>
          {iconMap[icon]}
        </span>
      </div>
      <p className="text-3xl font-bold text-gray-900">{value}</p>
    </div>
  );
}
