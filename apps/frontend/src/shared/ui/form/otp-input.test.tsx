import { expect, mock, test } from 'bun:test';
import React from 'react';

// Bun shares its module registry across suite files; a child isolates the RN mocks
// from unrelated tests that have already imported the native entrypoint.
if (process.env.SELENE_OTP_INPUT_MOUNT_CHILD !== '1') {
  test('mounts the OTP input in an isolated Bun process', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_OTP_INPUT_MOUNT_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (child.exitCode !== 0)
      throw new Error(new TextDecoder().decode(child.stderr));
    expect(child.exitCode).toBe(0);
  });
} else {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

  const host =
    (name: string) =>
    ({
      children,
      ...props
    }: React.PropsWithChildren<Record<string, unknown>>) =>
      React.createElement(name, props, children);

  const focus = mock(() => undefined);
  const TextInput = React.forwardRef<{ focus: () => void }>((props, ref) => {
    React.useImperativeHandle(ref, () => ({ focus }));
    return React.createElement('TextInput', props);
  });
  mock.module('react-native', () => ({
    TextInput,
    Pressable: host('Pressable'),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
      absoluteFill: {},
    },
  }));
  mock.module('react-i18next', () => ({
    useTranslation: (namespace: string) => ({
      t: (key: string) => `${namespace}:${key}`,
    }),
  }));
  mock.module('../base', () => ({ Box: host('Box'), Text: host('Text') }));

  const { act, fireEvent, render } =
    await import('@testing-library/react-native');
  const { OtpInput } = await import('./otp-input');

  const mountInput = async (onChangeText = mock<(code: string) => void>()) => {
    const ref = React.createRef<{ clear: () => void }>();
    const view = await render(
      <OtpInput ref={ref} onChangeText={onChangeText} />,
    );
    const input = () => view.getByLabelText('auth:otpInputLabel');
    const digits = () =>
      view.container
        .queryAll((el) => el.type === 'Text')
        .map((el) => el.props.children);
    const box = () => view.getByLabelText('auth:otpInputLabel').parent!;
    return { ref, onChangeText, input, digits, box };
  };

  test('configures one hidden input for one-time-code autofill', async () => {
    const { input, digits } = await mountInput();
    expect(input().props.textContentType).toBe('oneTimeCode');
    expect(input().props.autoComplete).toBe('sms-otp');
    // No native maxLength: it would cut a pasted "123 456" to "123 45" before
    // the separators are removed. The component trims to six digits itself.
    expect(input().props.maxLength).toBeUndefined();
    expect(input().props.keyboardType).toBe('number-pad');
    expect(digits()).toHaveLength(6);
  });

  test('typing fills the boxes and reports the digits', async () => {
    const { input, digits, onChangeText } = await mountInput();
    await fireEvent.changeText(input(), '123');
    expect(onChangeText).toHaveBeenLastCalledWith('123');
    expect(digits()).toEqual(['1', '2', '3', '', '', '']);
  });

  test('a pasted code keeps digits only, whatever the separators', async () => {
    const { input, digits, onChangeText } = await mountInput();
    await fireEvent.changeText(input(), '12 3-4a5');
    expect(onChangeText).toHaveBeenLastCalledWith('12345');
    expect(digits()).toEqual(['1', '2', '3', '4', '5', '']);
    await fireEvent.changeText(input(), '123 456');
    expect(onChangeText).toHaveBeenLastCalledWith('123456');
    await fireEvent.changeText(input(), '123456789');
    expect(onChangeText).toHaveBeenLastCalledWith('123456');
    expect(input().props.value).toBe('123456');
  });

  test('clear() empties the boxes and reports an empty code', async () => {
    const { ref, input, digits, onChangeText } = await mountInput();
    await fireEvent.changeText(input(), '654321');
    await act(async () => ref.current!.clear());
    expect(input().props.value).toBe('');
    expect(digits()).toEqual(['', '', '', '', '', '']);
    expect(onChangeText).toHaveBeenLastCalledWith('');
  });

  test('pressing the boxes focuses the hidden input', async () => {
    const { box } = await mountInput();
    focus.mockClear();
    await fireEvent.press(box());
    expect(focus).toHaveBeenCalledTimes(1);
  });
}
