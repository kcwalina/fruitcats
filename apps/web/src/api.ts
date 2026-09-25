// Where the Fruitcats API is. VITE_API points the game at another one, such as the API run on your own computer
// (npm run api:local): VITE_API=http://localhost:8790 npm run dev. In dev, `?api=http://localhost:8790` does too, or
// the computer's address on your home network (?api=http://192.168.1.62:8790) to play from another device.
const devApi = import.meta.env.DEV ? new URLSearchParams(location.search).get('api') : null;
const LOCAL_NETWORK = /^http:\/\/(localhost|127\.0\.0\.1|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2}):\d+$/;
export const API: string = (devApi && LOCAL_NETWORK.test(devApi) ? devApi : null)
  ?? import.meta.env.VITE_API ?? 'https://api.fruitcats.viamochi.com';
