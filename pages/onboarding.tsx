/**
 * Student Onboarding Page
 * Multi-step onboarding flow for new students
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';

interface OnboardingData {
  // Step 1: Personal Details
  fullName: string;
  dateOfBirth: string;
  gender: string;
  contactNumber: string;
  profilePhoto?: string;
  
  // Step 2: Educational Background
  educationLevel: string;
  certifications: string;
  
  // Step 3: Trading Experience
  tradingLevel: 'beginner' | 'intermediate' | 'advanced';
  yearsOfExperience: string;
  
  // Step 4: Preferences
  preferredTopics: string[];
  notificationPreferences: {
    email: boolean;
    sms: boolean;
    push: boolean;
  };
}

export default function Onboarding() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string>('');
  const [formData, setFormData] = useState<OnboardingData>({
    fullName: '',
    dateOfBirth: '',
    gender: '',
    contactNumber: '',
    profilePhoto: '',
    educationLevel: '',
    certifications: '',
    tradingLevel: 'beginner',
    yearsOfExperience: '0',
    preferredTopics: [],
    notificationPreferences: {
      email: true,
      sms: false,
      push: true,
    },
  });

  // Redirect if not authenticated or not a student
  useEffect(() => {
    if (!authLoading) {
      if (!isAuthenticated) {
        router.push('/login');
      } else if (user && user.role !== 'student') {
        router.push('/dashboard');
      }
    }
  }, [isAuthenticated, authLoading, user, router]);

  // Load existing onboarding data if available
  useEffect(() => {
    if (user && user.id) {
      loadOnboardingData();
    }
  }, [user]);

  const loadOnboardingData = async () => {
    try {
      const data = await apiClient.get('/auth/me') as any;
      if (data.studentDetails || data.profilePhoto) {
        setFormData({
          fullName: data.studentDetails?.fullName || data.name || '',
          dateOfBirth: data.studentDetails?.dateOfBirth || '',
          gender: data.studentDetails?.gender || '',
          contactNumber: data.studentDetails?.contactNumber || '',
          profilePhoto: data.profilePhoto || '',
          educationLevel: data.studentDetails?.educationLevel || '',
          certifications: data.studentDetails?.certifications || '',
          tradingLevel: data.studentDetails?.tradingLevel || 'beginner',
          yearsOfExperience: data.studentDetails?.yearsOfExperience || '0',
          preferredTopics: data.studentDetails?.preferredTopics || [],
          notificationPreferences: data.studentDetails?.notificationPreferences || {
            email: true,
            sms: false,
            push: true,
          },
        });
        if (data.profilePhoto) {
          setPhotoPreview(data.profilePhoto);
        }
      }
    } catch (error) {
      console.error('Failed to load onboarding data:', error);
    }
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 5 * 1024 * 1024) {
        setError('Image size must be less than 5MB');
        return;
      }
      setSelectedPhoto(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  };

  const handlePhotoUpload = async () => {
    if (!selectedPhoto) return;

    setUploadingPhoto(true);
    setError('');

    try {
      const uploadFormData = new FormData();
      uploadFormData.append('profilePhoto', selectedPhoto);

      const response = await apiClient.post('/upload/profile', uploadFormData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      setFormData((prev) => ({ ...prev, profilePhoto: (response as any).imageUrl }));
      setSelectedPhoto(null);
    } catch (error: any) {
      setError(error.response?.data?.error || error.message || 'Failed to upload photo');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleInputChange = (field: keyof OnboardingData, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleNestedChange = (field: string, subField: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [field]: {
        ...(prev[field as keyof OnboardingData] as any),
        [subField]: value,
      },
    }));
  };

  const handleTopicToggle = (topic: string) => {
    setFormData((prev) => ({
      ...prev,
      preferredTopics: prev.preferredTopics.includes(topic)
        ? prev.preferredTopics.filter((t) => t !== topic)
        : [...prev.preferredTopics, topic],
    }));
  };

  const validateStep = (step: number): boolean => {
    switch (step) {
      case 1:
        if (!formData.fullName.trim() || !formData.dateOfBirth || !formData.contactNumber.trim()) {
          setError('Please fill in all required fields (Full Name, Date of Birth, Contact Number)');
          return false;
        }
        break;
      case 2:
        if (!formData.educationLevel) {
          setError('Please select your highest education level');
          return false;
        }
        break;
      case 3:
        if (!formData.tradingLevel || !formData.yearsOfExperience) {
          setError('Please complete all trading experience fields');
          return false;
        }
        break;
      case 4:
        if (formData.preferredTopics.length === 0) {
          setError('Please select at least one preferred learning topic');
          return false;
        }
        break;
    }
    setError('');
    return true;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      if (currentStep < 5) {
        setCurrentStep(currentStep + 1);
      }
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSubmit = async () => {
    if (!validateStep(5)) return;

    setLoading(true);
    setError('');

    try {
      await apiClient.post('/student/onboarding', formData);
      // Mark onboarding as complete (only if not already completed)
      if (!(user as any)?.onboardingCompleted) {
        await apiClient.put('/student/onboarding/complete');
      }
      // Refresh user data
      const userData = await apiClient.get('/auth/me') as any;
      // Update local storage
      const updatedUser = { ...user, ...userData };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      
      // Navigate to dashboard - students stay on /dashboard, other roles get redirected by dashboard page
      // Using window.location to ensure fresh auth context is loaded
      window.location.href = '/dashboard';
    } catch (error: any) {
      setError(error.response?.data?.error || error.message || 'Failed to save onboarding data');
      setLoading(false);
    }
  };

  if (authLoading || !isAuthenticated || (user && user.role !== 'student')) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  const steps = [
    { number: 1, title: 'Personal Details' },
    { number: 2, title: 'Education' },
    { number: 3, title: 'Trading Experience' },
    { number: 4, title: 'Preferences' },
    { number: 5, title: 'Confirmation' },
  ];

  const learningTopics = [
    'Technical Analysis',
    'Fundamental Analysis',
    'Risk Management',
    'Algorithmic Trading',
    'Forex Basics',
    'Trading Psychology',
    'Chart Patterns',
    'Indicators & Oscillators',
  ];

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />

      <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        <div className="mb-8">
          <h1 className="text-4xl font-display font-bold text-gray-900 dark:text-white mb-2">
            {(user as any)?.onboardingCompleted ? 'Edit Your Profile' : 'Welcome to ForexOrbit Academy!'}
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            {(user as any)?.onboardingCompleted 
              ? 'Update your profile information to personalize your learning experience'
              : "Let's set up your profile to personalize your learning experience"}
          </p>
        </div>

        {/* Progress Indicator */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            {steps.map((step, index) => (
              <div key={step.number} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-all ${
                      currentStep >= step.number
                        ? 'bg-primary-600 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {currentStep > step.number ? '✓' : step.number}
                  </div>
                  <span className="text-xs mt-2 text-center text-gray-600 dark:text-gray-400 hidden sm:block">
                    {step.title}
                  </span>
                </div>
                {index < steps.length - 1 && (
                  <div
                    className={`h-1 flex-1 mx-2 ${
                      currentStep > step.number
                        ? 'bg-primary-600'
                        : 'bg-gray-200 dark:bg-gray-700'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="text-center text-sm text-gray-500 dark:text-gray-400">
            Step {currentStep} of {steps.length}
          </div>
        </div>

        {/* Onboarding Form Card */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 sm:p-8">
          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl">
              <p className="text-red-800 dark:text-red-200 text-sm">{error}</p>
            </div>
          )}

          {/* Step 1: Personal Details */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Personal Details</h2>
              
              {/* Profile Photo Upload */}
              <div className="flex flex-col items-center mb-6 pb-6 border-b border-gray-200 dark:border-gray-700">
                <div className="relative mb-4">
                  <div className="w-24 h-24 rounded-full overflow-hidden bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center ring-4 ring-primary-100 dark:ring-primary-900">
                    {photoPreview ? (
                      <img
                        src={photoPreview}
                        alt="Profile"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-white text-3xl font-bold">
                        {formData.fullName?.charAt(0)?.toUpperCase() || user?.name?.charAt(0)?.toUpperCase() || 'U'}
                      </span>
                    )}
                  </div>
                  <label className="absolute bottom-0 right-0 bg-primary-600 text-white rounded-full p-2 cursor-pointer hover:bg-primary-700 transition-colors shadow-lg">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoSelect}
                      className="hidden"
                    />
                  </label>
                </div>
                {selectedPhoto && (
                  <button
                    type="button"
                    onClick={handlePhotoUpload}
                    disabled={uploadingPhoto}
                    className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {uploadingPhoto ? 'Uploading...' : 'Upload Photo'}
                  </button>
                )}
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 text-center">
                  Optional: Upload a profile photo (max 5MB)
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.fullName}
                  onChange={(e) => handleInputChange('fullName', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                  placeholder="Enter your full name"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Date of Birth <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={formData.dateOfBirth}
                    onChange={(e) => handleInputChange('dateOfBirth', e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Gender
                  </label>
                  <select
                    value={formData.gender}
                    onChange={(e) => handleInputChange('gender', e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                  >
                    <option value="">Prefer not to say</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Contact Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  value={formData.contactNumber}
                  onChange={(e) => handleInputChange('contactNumber', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                  placeholder="+1234567890"
                  required
                />
              </div>
            </div>
          )}

          {/* Step 2: Educational Background */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Educational Background</h2>
              
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl p-6 border border-blue-100 dark:border-blue-800">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Highest Education Level <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.educationLevel}
                    onChange={(e) => handleInputChange('educationLevel', e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all shadow-sm"
                    required
                  >
                    <option value="">Select education level</option>
                    <option value="high-school">High School</option>
                    <option value="diploma">Diploma</option>
                    <option value="bachelor">Bachelor's Degree</option>
                    <option value="master">Master's Degree</option>
                    <option value="phd">PhD</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              <div className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 rounded-xl p-6 border border-purple-100 dark:border-purple-800">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Relevant Certifications (Optional)
                  </label>
                  <textarea
                    value={formData.certifications}
                    onChange={(e) => handleInputChange('certifications', e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all shadow-sm resize-none"
                    rows={4}
                    placeholder="List any relevant certifications (e.g., CFA, Series 7, etc.)"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Trading Experience */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Trading Experience</h2>
              
              <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl p-6 border border-green-100 dark:border-green-800">
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
                  Trading Level <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {(['beginner', 'intermediate', 'advanced'] as const).map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => handleInputChange('tradingLevel', level)}
                      className={`p-5 rounded-xl border-2 transition-all transform hover:scale-105 ${
                        formData.tradingLevel === level
                          ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 shadow-lg scale-105'
                          : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:border-primary-400 hover:shadow-md'
                      }`}
                    >
                      <div className="font-bold text-lg capitalize mb-1">{level}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {level === 'beginner' && 'Just starting out'}
                        {level === 'intermediate' && 'Some experience'}
                        {level === 'advanced' && 'Expert trader'}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-gradient-to-br from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/20 rounded-xl p-6 border border-yellow-100 dark:border-yellow-800">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Years of Forex/Trading Experience <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.yearsOfExperience}
                    onChange={(e) => handleInputChange('yearsOfExperience', e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all shadow-sm"
                    required
                  >
                    <option value="0">Less than 1 year</option>
                    <option value="1-2">1-2 years</option>
                    <option value="3-5">3-5 years</option>
                    <option value="6-10">6-10 years</option>
                    <option value="10+">More than 10 years</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Preferences */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Learning Preferences</h2>
              
              <div className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-xl p-6 border border-indigo-100 dark:border-indigo-800">
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
                  Preferred Learning Topics <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {learningTopics.map((topic) => (
                    <button
                      key={topic}
                      type="button"
                      onClick={() => handleTopicToggle(topic)}
                      className={`p-3 rounded-xl border-2 transition-all text-sm font-medium transform hover:scale-105 ${
                        formData.preferredTopics.includes(topic)
                          ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 shadow-md scale-105'
                          : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:border-primary-400 hover:shadow-sm'
                      }`}
                    >
                      {topic}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-gradient-to-br from-teal-50 to-cyan-50 dark:from-teal-900/20 dark:to-cyan-900/20 rounded-xl p-6 border border-teal-100 dark:border-teal-800">
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
                  Notification Preferences
                </label>
                <div className="space-y-3">
                  {[
                    { key: 'email', label: 'Email Notifications', icon: '📧' },
                    { key: 'sms', label: 'SMS Notifications', icon: '💬' },
                    { key: 'push', label: 'Push Notifications', icon: '🔔' },
                  ].map(({ key, label, icon }) => (
                    <label key={key} className="flex items-center p-3 rounded-lg hover:bg-white/50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.notificationPreferences[key as keyof typeof formData.notificationPreferences]}
                        onChange={(e) => handleNestedChange('notificationPreferences', key, e.target.checked)}
                        className="w-5 h-5 text-primary-600 rounded focus:ring-primary-500"
                      />
                      <span className="ml-3 text-lg mr-2">{icon}</span>
                      <span className="text-gray-700 dark:text-gray-300 font-medium">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 5: Confirmation */}
          {currentStep === 5 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Review Your Information</h2>
              
              <div className="space-y-4">
                <div className="bg-gradient-to-br from-primary-50 to-primary-100 dark:from-primary-900/20 dark:to-primary-800/20 rounded-xl p-5 border border-primary-200 dark:border-primary-800">
                  <h3 className="font-bold text-lg text-gray-900 dark:text-white mb-4 flex items-center">
                    <span className="mr-2">👤</span> Personal Details
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-600 dark:text-gray-400 font-medium">Name:</span>
                      <p className="text-gray-900 dark:text-white font-semibold">{formData.fullName}</p>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400 font-medium">Date of Birth:</span>
                      <p className="text-gray-900 dark:text-white font-semibold">{formData.dateOfBirth || 'Not provided'}</p>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400 font-medium">Gender:</span>
                      <p className="text-gray-900 dark:text-white font-semibold capitalize">{formData.gender || 'Not provided'}</p>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400 font-medium">Contact:</span>
                      <p className="text-gray-900 dark:text-white font-semibold">{formData.contactNumber}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl p-5 border border-blue-200 dark:border-blue-800">
                  <h3 className="font-bold text-lg text-gray-900 dark:text-white mb-4 flex items-center">
                    <span className="mr-2">🎓</span> Education
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-600 dark:text-gray-400 font-medium">Education Level:</span>
                      <p className="text-gray-900 dark:text-white font-semibold capitalize">{formData.educationLevel || 'Not provided'}</p>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400 font-medium">Certifications:</span>
                      <p className="text-gray-900 dark:text-white font-semibold">{formData.certifications || 'None'}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl p-5 border border-green-200 dark:border-green-800">
                  <h3 className="font-bold text-lg text-gray-900 dark:text-white mb-4 flex items-center">
                    <span className="mr-2">📈</span> Trading Experience
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-600 dark:text-gray-400 font-medium">Level:</span>
                      <p className="text-gray-900 dark:text-white font-semibold capitalize">{formData.tradingLevel}</p>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400 font-medium">Experience:</span>
                      <p className="text-gray-900 dark:text-white font-semibold">{formData.yearsOfExperience} years</p>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 rounded-xl p-5 border border-purple-200 dark:border-purple-800">
                  <h3 className="font-bold text-lg text-gray-900 dark:text-white mb-4 flex items-center">
                    <span className="mr-2">⚙️</span> Preferences
                  </h3>
                  <div className="space-y-3 text-sm">
                    <div>
                      <span className="text-gray-600 dark:text-gray-400 font-medium">Preferred Topics:</span>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {formData.preferredTopics.length > 0 ? (
                          formData.preferredTopics.map((topic) => (
                            <span
                              key={topic}
                              className="px-3 py-1 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full text-xs font-medium"
                            >
                              {topic}
                            </span>
                          ))
                        ) : (
                          <span className="text-gray-500 dark:text-gray-400">None selected</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400 font-medium">Notifications:</span>
                      <div className="flex flex-wrap gap-4 mt-2">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          formData.notificationPreferences.email
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                        }`}>
                          📧 Email: {formData.notificationPreferences.email ? 'On' : 'Off'}
                        </span>
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          formData.notificationPreferences.sms
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                        }`}>
                          💬 SMS: {formData.notificationPreferences.sms ? 'On' : 'Off'}
                        </span>
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          formData.notificationPreferences.push
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                        }`}>
                          🔔 Push: {formData.notificationPreferences.push ? 'On' : 'Off'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="flex justify-between mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleBack}
                disabled={currentStep === 1}
                className="px-6 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Back
              </button>
              {currentStep === 1 && !(user as any)?.onboardingCompleted && (
                <button
                  type="button"
                  onClick={() => router.push('/dashboard')}
                  className="px-6 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Skip for Now
                </button>
              )}
            </div>

            {currentStep < 5 ? (
              <button
                type="button"
                onClick={handleNext}
                className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors"
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading}
                className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading 
                  ? 'Saving...' 
                  : (user as any)?.onboardingCompleted 
                    ? 'Save Changes' 
                    : 'Complete Onboarding'}
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

