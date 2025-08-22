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
     * R16.1, R16.2, R16.3, R17: Performs login to the target site, handling the two-step 302 redirect.
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
            // R17: Step 1 - POST the login form. Expect a 302 redirect.
            const postResponse = await axios.post(LOGIN_URL, params, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Referer': LOGIN_URL,
                },
                maxRedirects: 0, // We manually handle redirects
                validateStatus: (status) => status === 302, // A 302 is a successful POST
            });

            const cookiesFromPost = postResponse.headers['set-cookie'] || [];
            const firstRedirectLocation = postResponse.headers['location'];

            if (!firstRedirectLocation) {
                log('Login Step 1 FAILED: Did not receive a "location" header for redirect after POST. Check credentials or site logic.');
                return false;
            }
            log('Login Step 1 OK: Received 302 redirect to %s', firstRedirectLocation);
            
            // R17: Step 2 - Follow the first redirect. Expect another 302 with the final session cookie.
            const getResponse = await axios.get(firstRedirectLocation, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Referer': LOGIN_URL,
                    // Pass along any cookies we received from the first step
                    'Cookie': cookiesFromPost.map(c => c.split(';')[0]).join('; '),
                },
                maxRedirects: 0,
                validateStatus: (status) => status === 302, // The user_id is set on this 302
            });

            const cookiesFromGet = getResponse.headers['set-cookie'] || [];
            if (cookiesFromGet.length === 0) {
                 log('Login Step 2 FAILED: The second redirect did not return a "set-cookie" header.');
                 return false;
            }
            log('Login Step 2 OK: Received second 302 redirect and "set-cookie" header.');

            // R17: The final session cookie is in the headers of the *second* response.
            const userIdCookie = cookiesFromGet.find(c => c.startsWith('user_id='));

            if (userIdCookie) {
                this._cookie = userIdCookie.split(';')[0]; // Extract just the 'key=value' part.
                log('Login SUCCESS. Session cookie captured: %s', this._cookie);
                this.isInitialized = true;
                return true;
            } else {
                log('Login FAILED: "user_id" cookie was not found in the final redirect response headers.');
                this._cookie = null;
                return false;
            }

        } catch (error) {
            log('An unexpected error occurred during the login process: %s', error.message);
            if (error.response) {
                log('Login error response status: %d. Headers: %o', error.response.status, error.response.headers);
            }
            this._cookie = null;
            return false;
        }
    }
}

// Export a singleton instance.
export default new SessionManager();
