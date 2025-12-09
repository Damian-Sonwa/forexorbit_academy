/**
 * Home Page
 * Landing page with featured courses
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import CourseCard from '@/components/CourseCard';
import { useCourses } from '@/hooks/useCourses';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';

export default function Home() {
  const [filters, setFilters] = useState({ category: '', difficulty: '', search: '' });
  const { courses, loading, enroll, unenroll } = useCourses(filters);
  // const { isAuthenticated } = useAuth(); // Reserved for future use
  const [stats, setStats] = useState({ users: 0, courses: 0, success: 0, time: 0 });
  const [instructors, setInstructors] = useState<any[]>([]);

  // Load instructors
  useEffect(() => {
    const loadInstructors = async () => {
      try {
        const data = await apiClient.get('/instructors');
        setInstructors(data as any[]);
      } catch (error) {
        console.error('Failed to load instructors:', error);
        // Fallback to default instructors if API fails
        setInstructors([
          {
            name: 'John Smith',
            title: 'Senior Forex Analyst',
            description: '15+ years of trading experience, specializing in technical analysis and risk management.',
            imageUrl: '',
          },
          {
            name: 'Sarah Johnson',
            title: 'Fundamental Analysis Expert',
            description: 'Expert in economic indicators and market fundamentals with a proven track record.',
            imageUrl: '',
          },
          {
            name: 'Michael Chen',
            title: 'Algorithmic Trading Specialist',
            description: 'Master of automated trading systems and algorithmic strategies for advanced traders.',
            imageUrl: '',
          },
        ]);
      }
    };
    loadInstructors();
  }, []);

  // Animated counter effect
  useEffect(() => {
    const targets = { users: 10000, courses: courses.length || 50, success: 95, time: 24 };
    const duration = 2000;
    const steps = 60;
    const increment = duration / steps;

    const counters = Object.keys(targets).map((key) => {
      const target = targets[key as keyof typeof targets];
      let current = 0;
      const step = target / steps;

      const timer = setInterval(() => {
        current += step;
        if (current >= target) {
          current = target;
          clearInterval(timer);
        }
        setStats((prev) => ({ ...prev, [key]: Math.floor(current) }));
      }, increment);

      return timer;
    });

    return () => counters.forEach((timer) => clearInterval(timer));
  }, [courses.length]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1">
        {/* Hero Section with Flipping Slideshow */}
        <section className="relative h-[500px] sm:h-[600px] md:h-[700px] overflow-hidden">
          {/* Slideshow Background Images */}
          <div className="absolute inset-0">
            {/* Slide 1: Forex Market Trading */}
            <div className="slideshow-item absolute inset-0">
              <img
                src="https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=2070&q=80"
                alt="Forex market trading charts and financial graphs showing currency exchange rates and market trends"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-br from-[#1E88E5]/80 via-[#1565C0]/80 to-prussian/80" />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center text-white px-4">
                  <p className="text-xl sm:text-2xl md:text-3xl font-bold drop-shadow-2xl">Forex Market Analysis</p>
                  <p className="text-xs sm:text-sm md:text-base mt-2 text-white/90 drop-shadow-lg">Real-time trading insights and market trends</p>
                </div>
              </div>
            </div>
            {/* Slide 2: Students Learning */}
            <div className="slideshow-item absolute inset-0">
              <img
                src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=2071&q=80"
                alt="Students learning and collaborating on financial education, online learning platform"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-br from-[#00897B]/80 via-[#00695C]/80 to-prussian/80" />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center text-white px-4">
                  <p className="text-xl sm:text-2xl md:text-3xl font-bold drop-shadow-2xl">Students Learning Forex</p>
                  <p className="text-xs sm:text-sm md:text-base mt-2 text-white/90 drop-shadow-lg">Interactive courses designed for all skill levels</p>
                </div>
              </div>
            </div>
            {/* Slide 3: Forex Charts & Analytics */}
            <div className="slideshow-item absolute inset-0">
              <img
                src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=2070&q=80"
                alt="Financial charts, graphs, and data analytics showing forex trading patterns and market analysis"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-br from-[#283593]/80 via-[#1A237E]/80 to-prussian/80" />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center text-white px-4">
                  <p className="text-xl sm:text-2xl md:text-3xl font-bold drop-shadow-2xl">Forex Charts & Graphs</p>
                  <p className="text-xs sm:text-sm md:text-base mt-2 text-white/90 drop-shadow-lg">Advanced technical analysis and data visualization</p>
                </div>
              </div>
            </div>
          </div>

          {/* Overlay Content */}
          <div className="relative z-10 h-full flex items-center justify-center">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
              <div className="bg-black/50 backdrop-blur-sm rounded-2xl sm:rounded-3xl p-6 sm:p-8 md:p-12 border border-white/20">
                <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-7xl font-display font-bold mb-4 sm:mb-6 leading-tight drop-shadow-2xl">
                  <span className="bg-gradient-to-r from-primary-400 via-primary-300 to-secondary-400 bg-clip-text text-transparent">
                    ForexOrbit
                  </span>
                  <span className="text-white ml-2 sm:ml-3">Academy</span>
                </h1>
                <p className="text-base sm:text-lg md:text-xl lg:text-3xl mb-6 sm:mb-8 md:mb-10 text-white/90 max-w-3xl mx-auto leading-relaxed font-medium drop-shadow-lg px-2">
                  Master Forex Trading with Expert Instructors and Real-Time Market Signals
                </p>
                <div className="flex flex-col sm:flex-row justify-center items-center gap-3 sm:gap-4">
                  <Link 
                    href="/signup" 
                    className="w-full sm:w-auto px-6 sm:px-8 md:px-10 py-3 sm:py-3 md:py-4 bg-prussian hover:bg-prussian-dark text-white rounded-xl font-bold text-base sm:text-lg shadow-2xl hover:shadow-3xl transition-all transform hover:scale-105 text-center"
                  >
                    Start Learning Free
                  </Link>
                  <Link 
                    href="/courses" 
                    className="w-full sm:w-auto px-6 sm:px-8 md:px-10 py-3 sm:py-3 md:py-4 border-2 border-white text-white hover:bg-white/10 rounded-xl font-bold text-base sm:text-lg transition-all backdrop-blur-sm text-center"
                  >
                    Watch Demo
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Stats Section */}
        <section className="bg-gradient-to-br from-gray-50 to-gray-100 py-12 sm:py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold text-center text-gray-900 mb-8 sm:mb-12">
              Stats Overview
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
              <div className="bg-white rounded-xl p-4 sm:p-6 text-center shadow-md border border-gray-200 flex flex-col items-center justify-center h-full">
                <div className="text-3xl sm:text-4xl md:text-5xl font-bold text-[#1E88E5] mb-2 count-animate">
                  {stats.users.toLocaleString()}+
                </div>
                <div className="text-xs sm:text-sm md:text-base font-semibold text-gray-700">Active Users</div>
              </div>
              <div className="bg-white rounded-xl p-4 sm:p-6 text-center shadow-md border border-gray-200 flex flex-col items-center justify-center h-full">
                <div className="text-3xl sm:text-4xl md:text-5xl font-bold text-[#00897B] mb-2 count-animate">
                  {stats.courses}+
                </div>
                <div className="text-xs sm:text-sm md:text-base font-semibold text-gray-700">Expert Courses</div>
              </div>
              <div className="bg-white rounded-xl p-4 sm:p-6 text-center shadow-md border border-gray-200 flex flex-col items-center justify-center h-full">
                <div className="text-3xl sm:text-4xl md:text-5xl font-bold text-[#283593] mb-2 count-animate">
                  {stats.success}%
                </div>
                <div className="text-xs sm:text-sm md:text-base font-semibold text-gray-700">Success Rate</div>
              </div>
              <div className="bg-white rounded-xl p-4 sm:p-6 text-center shadow-md border border-gray-200 flex flex-col items-center justify-center h-full">
                <div className="text-3xl sm:text-4xl md:text-5xl font-bold text-prussian mb-2 count-animate">
                  {stats.time}/7
                </div>
                <div className="text-xs sm:text-sm md:text-base font-semibold text-gray-700">Activated Time</div>
              </div>
            </div>
          </div>
        </section>

        {/* Why Choose Us Section */}
        <section className="py-12 sm:py-16 md:py-20 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-display font-bold text-center text-gray-900 mb-4">
              Why Choose Us
            </h2>
            <p className="text-base sm:text-lg md:text-xl text-gray-600 text-center mb-8 sm:mb-12 max-w-2xl mx-auto px-4">
              Comprehensive Forex education designed for all skill levels
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {/* Card 1: Beginner to Advanced */}
              <div className="bg-gradient-to-br from-[#E8F2FB] to-white rounded-xl p-6 shadow-md border-2 border-[#1E88E5]/20 hover:shadow-lg transition-all flex flex-col h-full">
                <div className="w-16 h-16 bg-[#1E88E5] rounded-xl flex items-center justify-center mb-4 overflow-hidden flex-shrink-0">
                  <img 
                    src="https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=100&h=100&fit=crop&crop=center" 
                    alt="Forex trading courses"
                    className="w-full h-full object-cover"
                  />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Structured Courses</h3>
                <p className="text-gray-700 leading-relaxed text-sm flex-grow">
                  From beginner to advanced, our structured courses guide you through every step of Forex trading mastery.
                </p>
              </div>

              {/* Card 2: Expert Instructors */}
              <div className="bg-gradient-to-br from-[#E3F6F4] to-white rounded-xl p-6 shadow-md border-2 border-[#00897B]/20 hover:shadow-lg transition-all flex flex-col h-full">
                <div className="w-16 h-16 bg-[#00897B] rounded-xl flex items-center justify-center mb-4 overflow-hidden flex-shrink-0">
                  <img 
                    src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=100&h=100&fit=crop&crop=faces" 
                    alt="Expert Forex instructors"
                    className="w-full h-full object-cover"
                  />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Expert Instructors</h3>
                <p className="text-gray-700 leading-relaxed text-sm flex-grow">
                  Learn from industry professionals with years of real-world trading experience and proven track records.
                </p>
              </div>

              {/* Card 3: Practical Lessons */}
              <div className="bg-gradient-to-br from-[#ECEFF9] to-white rounded-xl p-6 shadow-md border-2 border-[#283593]/20 hover:shadow-lg transition-all flex flex-col h-full">
                <div className="w-16 h-16 bg-[#283593] rounded-xl flex items-center justify-center mb-4 overflow-hidden flex-shrink-0">
                  <img 
                    src="https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=100&h=100&fit=crop&crop=center" 
                    alt="Practical trading lessons"
                    className="w-full h-full object-cover"
                  />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Practical Lessons</h3>
                <p className="text-gray-700 leading-relaxed text-sm flex-grow">
                  Hands-on lessons with real market examples, live trading scenarios, and interactive exercises.
                </p>
              </div>

              {/* Card 4: Real-time Market Analysis */}
              <div className="bg-gradient-to-br from-[#E8F2FB] to-white rounded-xl p-6 shadow-md border-2 border-[#1E88E5]/20 hover:shadow-lg transition-all flex flex-col h-full">
                <div className="w-16 h-16 bg-[#1E88E5] rounded-xl flex items-center justify-center mb-4 overflow-hidden flex-shrink-0">
                  <img 
                    src="https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=100&h=100&fit=crop&crop=center" 
                    alt="Real-time market analysis charts"
                    className="w-full h-full object-cover"
                  />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Real-Time Analysis</h3>
                <p className="text-gray-700 leading-relaxed text-sm flex-grow">
                  Access live market signals, real-time charts, and instant market analysis to enhance your learning.
                </p>
              </div>

              {/* Card 5: Certification */}
              <div className="bg-gradient-to-br from-[#E3F6F4] to-white rounded-xl p-6 shadow-md border-2 border-[#00897B]/20 hover:shadow-lg transition-all flex flex-col h-full">
                <div className="w-16 h-16 bg-[#00897B] rounded-xl flex items-center justify-center mb-4 overflow-hidden flex-shrink-0">
                  <img 
                    src="https://images.unsplash.com/photo-1450101499163-c8848c66ca85?w=100&h=100&fit=crop&crop=center" 
                    alt="Forex trading certification"
                    className="w-full h-full object-cover"
                  />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Certification</h3>
                <p className="text-gray-700 leading-relaxed text-sm flex-grow">
                  Earn recognized certificates upon course completion to showcase your Forex trading expertise.
                </p>
              </div>

              {/* Card 6: Mobile-Friendly */}
              <div className="bg-gradient-to-br from-[#ECEFF9] to-white rounded-xl p-6 shadow-md border-2 border-[#283593]/20 hover:shadow-lg transition-all flex flex-col h-full">
                <div className="w-16 h-16 bg-[#283593] rounded-xl flex items-center justify-center mb-4 overflow-hidden flex-shrink-0">
                  <img 
                    src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=100&h=100&fit=crop&crop=center" 
                    alt="Mobile trading platform"
                    className="w-full h-full object-cover"
                  />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Mobile-Friendly</h3>
                <p className="text-gray-700 leading-relaxed text-sm flex-grow">
                  Learn on-the-go with our fully responsive platform optimized for mobile, tablet, and desktop devices.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Instructor Section */}
        <section className="py-12 sm:py-16 md:py-20 bg-gradient-to-br from-gray-50 to-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-display font-bold text-center text-gray-900 mb-4">
              Learn from the Best
            </h2>
            <p className="text-base sm:text-lg md:text-xl text-gray-600 text-center mb-8 sm:mb-12 max-w-2xl mx-auto px-4">
              Our expert instructors bring years of real-world trading experience to help you succeed
            </p>
            {instructors.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-xl shadow-md border border-gray-200">
                <p className="text-gray-500">No instructors available yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {instructors.map((instructor: any, index: number) => {
                  const colors = [
                    { from: '#1E88E5', to: '#1565C0', text: '#1E88E5' },
                    { from: '#00897B', to: '#00695C', text: '#00897B' },
                    { from: '#283593', to: '#1A237E', text: '#283593' },
                  ];
                  const color = colors[index % colors.length];
                  
                  return (
                    <div key={instructor._id || instructor.id || index} className="bg-white rounded-xl p-6 shadow-md border border-gray-200 hover:shadow-lg transition-all text-center flex flex-col items-center h-full">
                      {instructor.imageUrl ? (
                        <img
                          src={instructor.imageUrl}
                          alt={instructor.name}
                          className="w-24 h-24 object-cover rounded-full mx-auto mb-4 border-4 border-gray-200 flex-shrink-0"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                            const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                            if (fallback) fallback.style.display = 'flex';
                          }}
                        />
                      ) : null}
                      <div
                        className="w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-4 flex-shrink-0"
                        style={{
                          background: instructor.imageUrl ? 'none' : `linear-gradient(to bottom right, ${color.from}, ${color.to})`,
                          display: instructor.imageUrl ? 'none' : 'flex',
                        }}
                      >
                        <span className="text-4xl text-white">{instructor.name?.charAt(0) || '👨‍💼'}</span>
                      </div>
                      <h3 className="text-lg font-bold text-gray-900 mb-2">{instructor.name}</h3>
                      <p className="font-semibold mb-2 text-sm" style={{ color: color.text }}>{instructor.title}</p>
                      <p className="text-gray-600 text-sm flex-grow">{instructor.description}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Courses Section */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {/* Section Title */}
          <div className="text-center mb-12">
            <h2 className="text-4xl md:text-5xl font-display font-bold text-gray-900 mb-4">
              Explore Our Courses
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Discover comprehensive Forex trading courses designed for all skill levels, from beginner to advanced
            </p>
          </div>

          {/* Filters */}
          <div className="bg-white rounded-xl shadow-md border border-gray-200 p-4 sm:p-6 mb-6 sm:mb-8">
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              <div className="flex-1 relative">
                <input
                  type="text"
                  placeholder="Search courses..."
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                  className="w-full pl-10 pr-4 py-2 sm:py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm sm:text-base"
                />
                <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <select
                value={filters.category}
                onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                className="px-3 sm:px-4 py-2 sm:py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white text-sm sm:text-base"
              >
                <option value="">All Categories</option>
                <option value="basics">Basics</option>
                <option value="technical">Technical Analysis</option>
                <option value="fundamental">Fundamental Analysis</option>
                <option value="trading">Trading Strategies</option>
              </select>
              <select
                value={filters.difficulty}
                onChange={(e) => setFilters({ ...filters, difficulty: e.target.value })}
                className="px-3 sm:px-4 py-2 sm:py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white text-sm sm:text-base"
              >
                <option value="">All Levels</option>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </div>
          </div>

          {/* Courses Grid */}
          {loading ? (
            <div className="text-center py-20">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mb-4"></div>
              <p className="text-gray-500 text-lg">Loading courses...</p>
            </div>
          ) : courses.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-xl shadow-md border border-gray-200">
              <div className="text-6xl mb-4">📚</div>
              <p className="text-gray-500 text-lg mb-2">No courses found</p>
              <p className="text-gray-400 text-sm">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {courses.map((course) => (
                <CourseCard
                  key={course._id || course.id}
                  course={course}
                  onEnroll={enroll}
                  onUnenroll={unenroll}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <Footer />
    </div>
  );
}

