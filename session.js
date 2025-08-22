import axios from 'axios';
import debug from 'debug';
import { URLSearchParams } from 'url';

const log = debug('addon:session');

const LOGIN_URL = 'https://tamilan24.com/login';
const USERNAME = process.env.SCRAPER_USERNAME;
const PASSWORD = process.env.SCRAPER_PASSWORD;

/**
 * R16: Manages the scraper's login session and cookie.
 * This class follows a singleton pattern to ensure one session across the application.
 */
class SessionManager {
    constructor() {
        if (SessionManager.instance) {
            return SessionManager.instance;
        }
        this._cookie = null;
        this.isInitialized = false;

        if (!USERNAME || !PASSWORD) {
            log('Warning: SCRAPER_USERNAME or SCRAPER_PASSWORD not set. Scraper will likely fail to get stream URLs.');
        }

        SessionManager.instance = this;
    }

    /**
     * R16.3: Returns the currently stored session cookie.
     * @returns {string|null} The session cookie.
     */
    getCookie() {
        return this._cookie;
    }

    /**
     * R16.1, R16.2, R16.3: Performs login to the target site.
     * @returns {Promise<boolean>} True if login was successful, false otherwise.
     */
    async login() {
        if (!USERNAME || !PASSWORD) {
            log('Cannot login. Credentials are not provided in environment variables.');
            return false;
        }

        log('Attempting to login to Tamilan24 with username: %s', USERNAME);

        const params = new URLSearchParams();
        params.append('username', USERNAME);
        params.append('password', PASSWORD);

        try {
            const response = await axios.post(LOGIN_URL, params, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Referer': LOGIN_URL,
                },
                maxRedirects: 0, // We must not follow redirects to capture the 'set-cookie' header
                validateStatus: function (status) {
                    return status >= 200 && status < 400; // Accept success (200) and redirect (3xx) statuses
                },
            });

            const setCookieHeader = response.headers['set-cookie'];
            if (setCookieHeader) {
                // R16.3: Find the specific user_id cookie which indicates a successful session.
                const userIdCookie = setCookieHeader.find(c => c.startsWith('user_id='));
                if (userIdCookie) {
                    this._cookie = userIdCookie.split(';')[0]; // Extract just the 'key=value' part.
                    log('Login successful. Session cookie captured: %s', this._cookie);
                    this.isInitialized = true;
                    return true;
                }
            }
            
            log('Login failed. Could not find user_id cookie in response headers. Response status: %d. This may be due to incorrect credentials.', response.status);
            this._cookie = null;
            return false;

        } catch (error) {
            log('An error occurred during login: %s', error.message);
            if (error.response) {
                log('Login error response status: %d, data: %o', error.response.status, error.response.data);
            }
            this._cookie = null;
            return false;
        }
    }
}

// Export a singleton instance.
export default new SessionManager();
