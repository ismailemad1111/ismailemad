export const authState = { currentUser: null };
export const browserSessionPersistence = {};
export const inMemoryPersistence = {};
export const initializeAuth = () => authState;
authState.authStateReady = async () => {};
export const signOut = async () => {};
export const signInWithEmailAndPassword = async () => { throw new Error("n/a"); };
export const createUserWithEmailAndPassword = async () => { throw new Error("n/a"); };
