import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://wpertokdnlebofdqfabm.supabase.co';
const supabaseAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndwZXJ0b2tkbmxlYm9mZHFmYWJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MzQ2ODMsImV4cCI6MjA5NjExMDY4M30.RsA2ljDdI957AY6_NBw8cCD0vxjoJ9pbnXyH9O2wExc';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
