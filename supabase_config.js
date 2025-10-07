// Supabase Configuration
// Replace these with your actual Supabase project credentials
const SUPABASE_URL = 'https://auaimthblrdkfvyubmdn.supabase.co'; // e.g., 'https://xxxxxxxxxxxxx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1YWltdGhibHJka2Z2eXVibWRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3ODgwMjEsImV4cCI6MjA3NTM2NDAyMX0.lB-xVUa2POvGGQIfLlOSXygWxOWDYN6pJaQmCV0n2Yw';

// Export for use in other files if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SUPABASE_URL, SUPABASE_ANON_KEY };
}