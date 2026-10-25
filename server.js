const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { getAIResponse } = require('./ai');
const { supabase } = require('./supabase');

const app = express();
app.use(cors());
app.use(express.json());

const ALLOWED_LANGUAGES = ['english', 'bemba', 'nyanja', 'tonga'];

app.get('/', (req, res) => {
  res.send('MindCare AI backend is running.');
});

app.post('/api/chat', async (req, res) => {
  const { session_id, channel, message, province, district, language } = req.body;

  if (!session_id || !channel || !message) {
    return res.status(400).json({ error: 'session_id, channel, and message are required' });
  }

  const chosenLanguage = ALLOWED_LANGUAGES.includes(language) ? language : 'english';

  try {
    const ai = await getAIResponse(message, chosenLanguage);

    await supabase.from('conversations').insert({
      session_id,
      channel,
      message,
      ai_reply: ai.reply,
    });

    if (ai.is_red_flag) {
      await supabase.from('flags').insert({
        session_id,
        flag_type: ai.flag_type,
        likely_cause: ai.likely_cause,
        province: province || 'Unknown',
        district: district || 'Unknown',
      });
    }

    res.json({ reply: ai.reply });
  } catch (err) {
    console.error('Error in /api/chat:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.get('/api/dashboard/flags', async (req, res) => {
  const { province } = req.query;

  try {
    let query = supabase.from('flags').select('*').order('created_at', { ascending: false });

    if (province) {
      query = query.eq('province', province);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('Error in /api/dashboard/flags:', err);
    res.status(500).json({ error: 'Could not fetch flags.' });
  }
});

app.get('/api/dashboard/summary', async (req, res) => {
  try {
    const { data, error } = await supabase.from('flags').select('flag_type, province');

    if (error) throw error;

    const totalFlags = data.length;

    const byType = {};
    const byProvince = {};

    data.forEach((flag) => {
      byType[flag.flag_type] = (byType[flag.flag_type] || 0) + 1;
      byProvince[flag.province] = (byProvince[flag.province] || 0) + 1;
    });

    res.json({
      total_flags: totalFlags,
      by_type: byType,
      by_province: byProvince,
    });
  } catch (err) {
    console.error('Error in /api/dashboard/summary:', err);
    res.status(500).json({ error: 'Could not fetch summary.' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));