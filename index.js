const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');
const cors = require('cors');
const fetch = require('node-fetch').default;
require('dotenv').config();

const app = express();
const port = 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(cors());
app.use(session({
    secret: 'your_secret_key_here',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false, maxAge: 3600000 } // 1 hour
}));

// MongoDB Connection
mongoose.connect('mongodb://127.0.0.1:27017/multi_service_db', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// User Schema
const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    email: { type: String, unique: true, sparse: true },
    password: { type: String, required: true }
});

const User = mongoose.model('User', userSchema);

// Blog Schema
const blogSchema = new mongoose.Schema({
    title: {type: String, required: true},
    body: {type: String, required: true},
    author: {type: String, default: 'Anonymous'}
}, {timestamps: true});

const Blog = mongoose.model('Blog', blogSchema);

// Middleware to check authentication
const isAuthenticated = (req, res, next) => {
    if (req.session.userId) {
        next();
    } else {
        res.status(401).send('Please login first');
    }
};

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Register route
app.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        // Check if user already exists
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).send('Username already exists');
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create new user
        const user = new User({
            username,
            email,
            password: hashedPassword
        });

        await user.save();
        res.status(201).send('Registration successful! Please login.');
    } catch (error) {
        res.status(500).send('Error registering user');
    }
});

// Login route
app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Find user
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).send('User not found');
        }

        // Check password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).send('Invalid password');
        }

        // Set session
        req.session.userId = user._id;
        req.session.username = user.username;

        res.status(200).send('Login successful!');
    } catch (error) {
        res.status(500).send('Error logging in');
    }
});

// Logout route
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).send('Could not log out');
        }
        res.redirect('/');
    });
});

// QR Code Generator Route
app.get('/qr-generator', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'qr-generator.html'));
});

app.post('/generate-qr', isAuthenticated, async (req, res) => {
    try {
        const { data } = req.body;
        const qrCode = await QRCode.toDataURL(data);
        res.json({ qrCode });
    } catch (error) {
        res.status(500).send('Error generating QR code');
    }
});

// BMI Calculator Route
app.get('/bmi-calculator', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'bmi-calculator.html'));
});

app.post('/calculate-bmi', isAuthenticated, (req, res) => {
    const weight = parseFloat(req.body.weight);
    const height = parseFloat(req.body.height) / 100;

    if (weight <= 0 || height <= 0) {
        return res.status(400).json({error: "Weight and height must be positive numbers."});
    }

    const bmi = calculateBmi(weight, height);
    const category = getBMICategory(bmi);

    res.json({
        bmi: bmi.toFixed(1),
        category: category
    });
});

function calculateBmi(weight, height) {
    return weight / (height * height);
}

function getBMICategory(bmi) {
    if (bmi < 18.5) return 'Underweight';
    if (bmi < 24.9 && bmi >= 18.5) return 'Normal weight';
    if (bmi < 29.9 && bmi >= 25) return 'Overweight';
    if (bmi >= 30) return 'Obese';
}

// Email Sender Route
app.get('/email-sender', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'email-sender.html'));
});

app.post('/send-email', isAuthenticated, async (req, res) => {
    try {
        const { to, subject, text } = req.body;

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: to,
            subject: subject,
            text: text
        };

        const info = await transporter.sendMail(mailOptions);
        res.status(200).json({ message: 'Email sent successfully', messageId: info.messageId });
    } catch (error) {
        console.error('Error sending email:', error);
        res.status(500).json({ error: 'Error sending email' });
    }
});

// Weather API Route
app.get('/weather-app', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'weather-app.html'));
});

app.get('/api/weather/:city', isAuthenticated, async (req, res) => {
    try {
        const { city } = req.params;
        const WEATHER_API_KEY = process.env.WEATHER_API_KEY;

        if (!WEATHER_API_KEY) {
            throw new Error('Weather API key is not configured');
        }

        const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${WEATHER_API_KEY}&units=metric`;
        
        const weatherResponse = await fetch(weatherUrl);
        
        if (!weatherResponse.ok) {
            throw new Error(`Weather API responded with status ${weatherResponse.status}`);
        }
        
        const weatherData = await weatherResponse.json();

        const processedData = {
            temperature: weatherData.main?.temp ?? 'N/A',
            description: weatherData.weather?.[0]?.description ?? 'N/A',
            icon: weatherData.weather?.[0]?.icon ?? '',
            coordinates: {
                lat: weatherData.coord?.lat ?? 0,
                lon: weatherData.coord?.lon ?? 0
            },
            feelsLike: weatherData.main?.feels_like ?? 'N/A',
            humidity: weatherData.main?.humidity ?? 'N/A',
            pressure: weatherData.main?.pressure ?? 'N/A',
            windSpeed: weatherData.wind?.speed ?? 'N/A',
            countryCode: weatherData.sys?.country ?? 'N/A',
            rainVolume: weatherData.rain?.['3h'] ?? 0
        };

        res.json(processedData);
    } catch (error) {
        console.error('Error in /api/weather:', error);
        res.status(500).json({ error: error.message });
    }
});

// Blog CRUD Routes
app.get('/blog-manager', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'blog-manager.html'));
});

// Create a blog post
app.post('/blogs', isAuthenticated, async (req, res) => {
    try {
        const blog = new Blog({
            ...req.body,
            author: req.session.username
        });
        const savedBlog = await blog.save();
        res.status(201).json(savedBlog);
    } catch(error) {
        res.status(400).json({error: error.message});
    }
});

// Get all blog posts
app.get('/blogs', isAuthenticated, async(req, res) => {
    try {
        const blogs = await Blog.find({ author: req.session.username });
        res.json(blogs);
    } catch(error) {
        res.status(500).json({error: error.message});
    }
});

// Get a specific blog post
app.get('/blogs/:id', isAuthenticated, async (req, res) => {
    try {
        const blog = await Blog.findOne({ 
            _id: req.params.id, 
            author: req.session.username 
        });
        if (!blog) return res.status(404).json({error: 'Blog post not found'});
        res.json(blog);
    } catch(error) {
        res.status(500).json({error: error.message});
    }
});

// Update a blog post
app.put('/blogs/:id', isAuthenticated, async (req, res) => {
    try {
        const blog = await Blog.findOneAndUpdate(
            { 
                _id: req.params.id, 
                author: req.session.username 
            },
            req.body,
            {new: true, runValidators: true}
        );
        if (!blog) return res.status(404).json({error: 'Blog post not found'});
        res.json(blog);
    } catch(error) {
        res.status(400).json({error: error.message});
    }
});

// Delete a blog post
app.delete('/blogs/:id', isAuthenticated, async(req, res) => {
    try {
        const blog = await Blog.findOneAndDelete({ 
            _id: req.params.id, 
            author: req.session.username 
        });
        if (!blog) return res.status(400).json({error: 'Blog post not found'});
        res.json({message: 'Blog post deleted successfully'});
    } catch (error) {
        res.status(500).json({error: error.message});
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});