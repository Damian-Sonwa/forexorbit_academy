/**
 * Learning Level Utilities (JavaScript version for server.js)
 * Handles level-based access control
 */

/**
 * Check if user has access to a room based on their learning level
 */
function canAccessRoom(userLevel, roomName) {
  // Non-students (instructors, admins) have access to all rooms
  if (userLevel === 'advanced' && roomName !== 'Beginner' && roomName !== 'Intermediate' && roomName !== 'Advanced') {
    return true; // For non-student roles
  }

  const roomLevel = roomName.toLowerCase();
  
  switch (userLevel) {
    case 'beginner':
      return roomLevel === 'beginner';
    case 'intermediate':
      return roomLevel === 'beginner' || roomLevel === 'intermediate';
    case 'advanced':
      return true; // Access to all rooms
    default:
      return false;
  }
}

module.exports = {
  canAccessRoom,
};








