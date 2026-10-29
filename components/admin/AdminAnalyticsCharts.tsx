/**
 * Admin analytics charts. Kept in its own module so recharts is only downloaded when the
 * Analytics tab is opened, not with the rest of the admin page.
 */
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useTheme } from '@/hooks/useTheme';
import { chartPalette, chartTooltipStyle } from '@/lib/chart-theme';

export interface AdminAnalyticsChartData {
  usersByRole?: { student?: number; instructor?: number; admin?: number };
  coursesByDifficulty?: { beginner?: number; intermediate?: number; advanced?: number };
  enrollmentTrends?: Array<{ day: string; enrollments: number }>;
  courseCompletion?: Array<{ course: string; enrolled: number; completed: number }>;
}

export default function AdminAnalyticsCharts({ analytics }: { analytics: AdminAnalyticsChartData }) {
  const { isDark } = useTheme();
  const c = chartPalette(isDark);
  const tooltipStyle = chartTooltipStyle(c);
  const roleSlices = [
    { name: 'Students', value: analytics.usersByRole?.student || 0, color: c.accent },
    { name: 'Instructors', value: analytics.usersByRole?.instructor || 0, color: c.strong },
    { name: 'Admins', value: analytics.usersByRole?.admin || 0, color: c.muted },
  ];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* User Roles Distribution - Pie Chart */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">User Roles Distribution</h3>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={roleSlices}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
              outerRadius={80}
              fill={c.accent}
              dataKey="value"
            >
              {roleSlices.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Course Difficulty Distribution - Bar Chart */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Courses by Difficulty</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={[
              { name: 'Beginner', courses: analytics.coursesByDifficulty?.beginner || 0 },
              { name: 'Intermediate', courses: analytics.coursesByDifficulty?.intermediate || 0 },
              { name: 'Advanced', courses: analytics.coursesByDifficulty?.advanced || 0 },
            ]}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
            <XAxis dataKey="name" stroke={c.axis} />
            <YAxis stroke={c.axis} />
            <Tooltip
              contentStyle={tooltipStyle}
            />
            <Bar dataKey="courses" fill={c.accent} radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Enrollment Trends - Line Chart */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Enrollment Trends (Last 7 Days)</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart
            data={analytics.enrollmentTrends || [
              { day: 'Mon', enrollments: 0 },
              { day: 'Tue', enrollments: 0 },
              { day: 'Wed', enrollments: 0 },
              { day: 'Thu', enrollments: 0 },
              { day: 'Fri', enrollments: 0 },
              { day: 'Sat', enrollments: 0 },
              { day: 'Sun', enrollments: 0 },
            ]}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
            <XAxis dataKey="day" stroke={c.axis} />
            <YAxis stroke={c.axis} />
            <Tooltip
              contentStyle={tooltipStyle}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="enrollments"
              stroke={c.accent}
              strokeWidth={2}
              dot={{ fill: c.accent, r: 4 }}
              name="Enrollments"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Course Completion Rate - Bar Chart */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Course Completion Rates</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={analytics.courseCompletion || [
              { course: 'Course 1', completed: 0, enrolled: 0 },
              { course: 'Course 2', completed: 0, enrolled: 0 },
              { course: 'Course 3', completed: 0, enrolled: 0 },
            ]}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
            <XAxis dataKey="course" stroke={c.axis} />
            <YAxis stroke={c.axis} />
            <Tooltip
              contentStyle={tooltipStyle}
            />
            <Legend />
            <Bar dataKey="enrolled" fill={c.accent} name="Enrolled" radius={[8, 8, 0, 0]} />
            <Bar dataKey="completed" fill="#10B981" name="Completed" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
