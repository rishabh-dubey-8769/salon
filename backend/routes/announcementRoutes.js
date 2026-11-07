const express = require('express');
const { getActiveAnnouncement } = require('../controllers/announcementController');
const { optionalProtect } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/active', optionalProtect, getActiveAnnouncement);

module.exports = router;
