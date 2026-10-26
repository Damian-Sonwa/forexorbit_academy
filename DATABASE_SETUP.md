# MongoDB Setup for Local Development

## Option 1: MongoDB Atlas (Cloud - Recommended)

1. Go to [MongoDB Atlas](https://www.mongodb.com/atlas)
2. Create a free account and cluster
3. Get your connection string
4. Create `.env.local` in project root:

```
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/Forex_elearning?retryWrites=true&w=majority
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
```

## Option 2: Local MongoDB

1. Install MongoDB Community Server
2. Start MongoDB service
3. Use local connection string:

```
MONGO_URI=mongodb://localhost:27017/Forex_elearning
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
```

## Populate Database

After setting up MongoDB:

```bash
npm run seed
```

This will create demo users and courses with descriptions.