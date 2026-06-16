import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://iwrfgdfxvyqdkqdtrrxg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3cmZnZGZ4dnlxZGtxZHRycnhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNjIxMzEsImV4cCI6MjA4OTkzODEzMX0.kQr7K_W-B2bcEYgQpxIrNFhORyiYT6_SZkfpC4S_AfQ';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
