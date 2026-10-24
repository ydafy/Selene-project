import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { supabase } from '../db/supabase';
import { GOOGLE_NO_ID_TOKEN } from './googleAuth.logic';
import {
  reauthenticate,
  type ReauthCredential,
  type ReauthDeps,
  type ReauthResult,
} from './reauth.logic';
import { signOutUser } from './signOut';
import { getCaptchaToken } from './captcha/captcha';
import { reauthSignInWithPassword } from './captchaAuth.logic';

const reauthDeps: ReauthDeps = {
  googleCancelledCode: statusCodes.SIGN_IN_CANCELLED,
  getSnapshot: async () => {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) return null;
    return {
      userId: session.user.id,
      email: session.user.email ?? null,
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
    };
  },
  signInWithPassword: (email, password) =>
    reauthSignInWithPassword(supabase.auth, getCaptchaToken, email, password),
  signInWithGoogle: async () => {
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const response = await GoogleSignin.signIn();
      if (response.type !== 'success') {
        return { userId: null, error: { code: statusCodes.SIGN_IN_CANCELLED } };
      }
      const idToken = response.data.idToken;
      if (!idToken) return { userId: null, error: { code: GOOGLE_NO_ID_TOKEN } };
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });
      return { userId: data.user?.id ?? null, error };
    } catch (error) {
      return { userId: null, error };
    }
  },
  restoreSession: async (snapshot) => {
    const { data, error } = await supabase.auth.setSession({
      access_token: snapshot.accessToken,
      refresh_token: snapshot.refreshToken,
    });
    return !error && data.user?.id === snapshot.userId;
  },
  signOutLocal: () => signOutUser('local'),
};

/** Re-signs in the current user with the real Supabase and Google clients. */
export const reauthenticateCurrentUser = (
  credential: ReauthCredential,
): Promise<ReauthResult> => reauthenticate(credential, reauthDeps);
