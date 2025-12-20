/**
 * User Profile Page
 * Display and edit user profile information
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import BackButton from '@/components/BackButton';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';

interface ProfileData {
  fullName: string;
  dateOfBirth: string;
  gender: string;
  contactNumber: string;
  educationLevel: string;
  certifications: string;
  tradingLevel: 'beginner' | 'intermediate' | 'advanced';
  yearsOfExperience: string;
  preferredTopics: string[];
  notificationPreferences: {
    email: boolean;
    sms: boolean;
    push: boolean;
  };
  profilePhoto?: string;
}

export default function Profile() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string>('');
  const [formData, setFormData] = useState<ProfileData>({
    fullName: '',
    dateOfBirth: '',
    gender: '',
    contactNumber: '',
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
    profilePhoto: '',
  });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, authLoading, router]);

  useEffect(() => {
    if (user) {
      loadProfileData();
    }
  }, [user]);

  const loadProfileData = async () => {
    try {
      const data = await apiClient.get('/auth/me') as any;
      if (data.studentDetails || data.profilePhoto) {
        setFormData({
          fullName: data.studentDetails?.fullName || data.name || '',
          dateOfBirth: data.studentDetails?.dateOfBirth || '',
          gender: data.studentDetails?.gender || '',
          contactNumber: data.studentDetails?.contactNumber || '',
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
          profilePhoto: data.profilePhoto || '',
        });
        if (data.profilePhoto) {
          setPhotoPreview(data.profilePhoto);
        }
      } else {
        // If no student details, use basic user info
        setFormData((prev) => ({
          ...prev,
          fullName: data.name || '',
        }));
      }
    } catch (error) {
      console.error('Failed to load profile data:', error);
    }
  };

  const handleInputChange = (field: keyof ProfileData, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleNestedChange = (field: string, subField: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [field]: {
        ...(prev[field as keyof ProfileData] as any),
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
      setSuccess('Profile photo uploaded successfully!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (error: any) {
      setError(error.response?.data?.error || error.message || 'Failed to upload photo');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await apiClient.post('/student/onboarding', formData);
      if (!(user as any)?.onboardingCompleted) {
        await apiClient.put('/student/onboarding/complete');
      }
      // Refresh user data
      const userData = await apiClient.get('/auth/me') as any;
      localStorage.setItem('user', JSON.stringify({ ...user, ...userData }));
      setIsEditing(false);
      setSuccess('Profile updated successfully!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (error: any) {
      setError(error.response?.data?.error || error.message || 'Failed to save profile');
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return <LoadingSpinner message="Loading profile..." fullScreen />;
  }

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

      <main className="flex-1 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {/* Back Button */}
        <div className="mb-6">
          <BackButton href="/dashboard" />
        </div>

        <div className="mb-8">
          <h1 className="text-4xl font-display font-bold text-gray-900 dark:text-white mb-2">
            My Profile
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Manage your profile information and preferences
          </p>
        </div>

        {/* Success/Error Messages */}
        {success && (
          <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-xl">
            <p className="text-green-800 dark:text-green-200 text-sm">{success}</p>
          </div>
        )}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl">
            <p className="text-red-800 dark:text-red-200 text-sm">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Profile Photo Section */}
          <div className="lg:col-span-1">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Profile Photo</h2>
              
              <div className="flex flex-col items-center">
                <div className="relative mb-4">
                  <div className="w-32 h-32 rounded-full overflow-hidden bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
                    {photoPreview ? (
                      <img
                        src={photoPreview}
                        alt="Profile"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-white text-4xl font-bold">
                        {formData.fullName?.charAt(0)?.toUpperCase() || user?.name?.charAt(0)?.toUpperCase() || 'U'}
                      </span>
                    )}
                  </div>
                  {isEditing && (
                    <label className="absolute bottom-0 right-0 bg-primary-600 text-white rounded-full p-2 cursor-pointer hover:bg-primary-700 transition-colors">
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
                  )}
                </div>

                {selectedPhoto && isEditing && (
                  <button
                    onClick={handlePhotoUpload}
                    disabled={uploadingPhoto}
                    className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-2"
                  >
                    {uploadingPhoto ? 'Uploading...' : 'Upload Photo'}
                  </button>
                )}

                <p className="text-sm text-gray-500 dark:text-gray-400 text-center mt-2">
                  {formData.fullName || user?.name || 'User'}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
                  {user?.email}
                </p>
              </div>
            </div>
          </div>

          {/* Profile Information Section */}
          <div className="lg:col-span-2">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 sm:p-8">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Profile Information</h2>
                {!isEditing ? (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors text-sm"
                  >
                    Edit Profile
                  </button>
                ) : (
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setIsEditing(false);
                        loadProfileData();
                      }}
                      className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={loading}
                      className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      {loading ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                )}
              </div>

              {isEditing ? (
                <div className="space-y-6">
                  {/* Personal Details */}
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Personal Details</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                          Full Name <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={formData.fullName}
                          onChange={(e) => handleInputChange('fullName', e.target.value)}
                          className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          placeholder="Enter your full name"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                          Date of Birth
                        </label>
                        <input
                          type="date"
                          value={formData.dateOfBirth}
                          onChange={(e) => handleInputChange('dateOfBirth', e.target.value)}
                          className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                          Gender
                        </label>
                        <select
                          value={formData.gender}
                          onChange={(e) => handleInputChange('gender', e.target.value)}
                          className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        >
                          <option value="">Prefer not to say</option>
                          <option value="male">Male</option>
                          <option value="female">Female</option>
                          <option value="other">Other</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                          Contact Number
                        </label>
                        <input
                          type="tel"
                          value={formData.contactNumber}
                          onChange={(e) => handleInputChange('contactNumber', e.target.value)}
                          className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          placeholder="+1234567890"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Educational Background */}
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Educational Background</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                          Education Level
                        </label>
                        <select
                          value={formData.educationLevel}
                          onChange={(e) => handleInputChange('educationLevel', e.target.value)}
                          className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
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

                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                          Certifications
                        </label>
                        <input
                          type="text"
                          value={formData.certifications}
                          onChange={(e) => handleInputChange('certifications', e.target.value)}
                          className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          placeholder="CFA, Series 7, etc."
                        />
                      </div>
                    </div>
                  </div>

                  {/* Trading Experience */}
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Trading Experience</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                          Trading Level
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                          {(['beginner', 'intermediate', 'advanced'] as const).map((level) => (
                            <button
                              key={level}
                              type="button"
                              onClick={() => handleInputChange('tradingLevel', level)}
                              className={`p-3 rounded-xl border-2 transition-all text-sm font-medium ${
                                formData.tradingLevel === level
                                  ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                                  : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:border-primary-400'
                              }`}
                            >
                              {level.charAt(0).toUpperCase() + level.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                          Years of Experience
                        </label>
                        <select
                          value={formData.yearsOfExperience}
                          onChange={(e) => handleInputChange('yearsOfExperience', e.target.value)}
                          className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent"
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

                  {/* Preferences */}
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Learning Preferences</h3>
                    <div className="mb-4">
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                        Preferred Learning Topics
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {learningTopics.map((topic) => (
                          <button
                            key={topic}
                            type="button"
                            onClick={() => handleTopicToggle(topic)}
                            className={`p-2 rounded-xl border-2 transition-all text-xs font-medium ${
                              formData.preferredTopics.includes(topic)
                                ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                                : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:border-primary-400'
                            }`}
                          >
                            {topic}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                        Notification Preferences
                      </label>
                      <div className="space-y-2">
                        {[
                          { key: 'email', label: 'Email Notifications' },
                          { key: 'sms', label: 'SMS Notifications' },
                          { key: 'push', label: 'Push Notifications' },
                        ].map(({ key, label }) => (
                          <label key={key} className="flex items-center">
                            <input
                              type="checkbox"
                              checked={formData.notificationPreferences[key as keyof typeof formData.notificationPreferences]}
                              onChange={(e) => handleNestedChange('notificationPreferences', key, e.target.checked)}
                              className="w-5 h-5 text-primary-600 rounded focus:ring-primary-500"
                            />
                            <span className="ml-3 text-gray-700 dark:text-gray-300">{label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Display Mode */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="bg-gradient-to-br from-primary-50 to-primary-100 dark:from-primary-900/20 dark:to-primary-800/20 rounded-xl p-4">
                      <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">Full Name</h3>
                      <p className="text-lg font-bold text-gray-900 dark:text-white">{formData.fullName || user?.name || 'Not set'}</p>
                    </div>

                    <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 rounded-xl p-4">
                      <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">Date of Birth</h3>
                      <p className="text-lg font-bold text-gray-900 dark:text-white">{formData.dateOfBirth || 'Not set'}</p>
                    </div>

                    <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 rounded-xl p-4">
                      <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">Contact Number</h3>
                      <p className="text-lg font-bold text-gray-900 dark:text-white">{formData.contactNumber || 'Not set'}</p>
                    </div>

                    <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 rounded-xl p-4">
                      <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">Education Level</h3>
                      <p className="text-lg font-bold text-gray-900 dark:text-white capitalize">{formData.educationLevel || 'Not set'}</p>
                    </div>

                    <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 dark:from-yellow-900/20 dark:to-yellow-800/20 rounded-xl p-4">
                      <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">Trading Level</h3>
                      <p className="text-lg font-bold text-gray-900 dark:text-white capitalize">{formData.tradingLevel || 'Not set'}</p>
                    </div>

                    <div className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900/20 dark:to-red-800/20 rounded-xl p-4">
                      <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">Experience</h3>
                      <p className="text-lg font-bold text-gray-900 dark:text-white">{formData.yearsOfExperience || '0'} years</p>
                    </div>
                  </div>

                  {formData.preferredTopics.length > 0 && (
                    <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4">
                      <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-3">Preferred Topics</h3>
                      <div className="flex flex-wrap gap-2">
                        {formData.preferredTopics.map((topic) => (
                          <span
                            key={topic}
                            className="px-3 py-1 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full text-sm font-medium"
                          >
                            {topic}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}



