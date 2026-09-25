// Where the Fruitcats API is. VITE_API points the game at another one, such as the API run on your own computer
// (npm run api:local): VITE_API=http://localhost:8790 npm run dev. In dev, `?api=http://localhost:8790` does too.
const devApi = import.meta.env.DEV ? new URLSearchParams(location.search).get('api') : null;
export const API: string = (devApi && /^http:\/\/localhost:\d+$/.test(devApi) ? devApi : null)
  ?? import.meta.env.VITE_API ?? 'https://api.fruitcats.viamochi.com';
