CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK (source IN ('Discord', 'GitHub', 'Twitter', 'Support Email')),
  message TEXT NOT NULL,
  sentiment TEXT NOT NULL CHECK (sentiment IN ('positive', 'negative', 'neutral')),
  category TEXT NOT NULL CHECK (category IN ('bug', 'feature-request', 'praise', 'complaint', 'question')),
  urgency INTEGER NOT NULL DEFAULT 1 CHECK (urgency >= 1 AND urgency <= 5),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_sentiment ON feedback(sentiment);
CREATE INDEX IF NOT EXISTS idx_feedback_urgency ON feedback(urgency);

-- Insert some sample data
INSERT INTO feedback (source, message, sentiment, category, urgency) VALUES
('Discord', 'The login button is not working on mobile devices. Users are unable to authenticate.', 'negative', 'Bug', 5),
('GitHub', 'Found a critical bug where data is being lost when switching between tabs.', 'negative', 'Bug', 5),
('Twitter', 'Amazing update! The new dashboard is exactly what we needed.', 'positive', 'Praise', 1),
('Support Email', 'Love the new UI design. Clean and intuitive.', 'positive', 'Praise', 1);