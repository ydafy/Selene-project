import { expect, mock, test } from 'bun:test';
import React from 'react';
// @ts-expect-error The installed test-only renderer has no local type declarations.
import { act, create } from 'react-test-renderer';

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
    StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {} },
  }));
  mock.module('react-i18next', () => ({
    useTranslation: (namespace: string) => ({
      t: (key: string) => `${namespace}:${key}`,
    }),
  }));
  mock.module('../base', () => ({ Box: host('Box'), Text: host('Text') }));

  const { OtpInput } = await import('./OtpInput');

  type Node = { type: unknown; props: Record<string, never> };
  const mountInput = async (onChangeText = mock<(code: string) => void>()) => {
    const ref = React.createRef<{ clear: () => void }>();
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<OtpInput ref={ref} onChangeText={onChangeText} />);
    });
    const input = () =>
      renderer!.root.find((node: Node) => node.type === 'TextInput');
    const digits = () =>
      renderer!.root
        .findAll((node: Node) => node.type === 'Text')
        .map((node: Node) => node.props.children);
    const root = () =>
      renderer!.root.find((node: Node) => node.type === 'Pressable');
    return { ref, onChangeText, input, digits, root };
  };

  test('configures one hidden input for one-time-code autofill', async () => {
    const { input, digits } = await mountInput();
    expect(input().props.textContentType).toBe('oneTimeCode');
    expect(input().props.autoComplete).toBe('sms-otp');
    // No native maxLength: it would cut a pasted "123 456" to "123 45" before
    // the separators are removed. The component trims to six digits itself.
    expect(input().props.maxLength).toBeUndefined();
    expect(input().props.keyboardType).toBe('number-pad');
    expect(input().props.accessibilityLabel).toBe('auth:otpInputLabel');
    expect(digits()).toHaveLength(6);
  });

  test('typing fills the boxes and reports the digits', async () => {
    const { input, digits, onChangeText } = await mountInput();
    await act(async () => input().props.onChangeText('123'));
    expect(onChangeText).toHaveBeenLastCalledWith('123');
    expect(digits()).toEqual(['1', '2', '3', '', '', '']);
  });

  test('a pasted code keeps digits only, whatever the separators', async () => {
    const { input, digits, onChangeText } = await mountInput();
    await act(async () => input().props.onChangeText('12 3-4a5'));
    expect(onChangeText).toHaveBeenLastCalledWith('12345');
    expect(digits()).toEqual(['1', '2', '3', '4', '5', '']);
    await act(async () => input().props.onChangeText('123 456'));
    expect(onChangeText).toHaveBeenLastCalledWith('123456');
    await act(async () => input().props.onChangeText('123456789'));
    expect(onChangeText).toHaveBeenLastCalledWith('123456');
    expect(input().props.value).toBe('123456');
  });

  test('clear() empties the boxes and reports an empty code', async () => {
    const { ref, input, digits, onChangeText } = await mountInput();
    await act(async () => input().props.onChangeText('654321'));
    await act(async () => ref.current!.clear());
    expect(input().props.value).toBe('');
    expect(digits()).toEqual(['', '', '', '', '', '']);
    expect(onChangeText).toHaveBeenLastCalledWith('');
  });

  test('pressing the boxes focuses the hidden input', async () => {
    const { root } = await mountInput();
    focus.mockClear();
    await act(async () => root().props.onPress());
    expect(focus).toHaveBeenCalledTimes(1);
  });
}
