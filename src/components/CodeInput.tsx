import React, { useRef, useState, useEffect } from 'react';
import { Group, TextInput } from '@mantine/core';

interface CodeInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
}

export default function CodeInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled = false,
}: CodeInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [digits, setDigits] = useState<string[]>(Array(length).fill(''));

  // Sync external value with internal state
  useEffect(() => {
    if (value.length === 0) {
      setDigits(Array(length).fill(''));
    } else if (value.length <= length) {
      const newDigits = value.split('').concat(Array(length - value.length).fill(''));
      setDigits(newDigits);
    }
  }, [value, length]);

  const focusInput = (index: number) => {
    if (inputRefs.current[index]) {
      inputRefs.current[index]?.focus();
    }
  };

  const handleChange = (index: number, newValue: string) => {
    // Only allow digits
    const digit = newValue.replace(/[^0-9]/g, '');

    if (digit.length > 1) {
      // Handle paste or multiple characters
      handlePaste(index, digit);
      return;
    }

    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);

    const code = newDigits.join('');
    onChange(code);

    // Auto-focus next input
    if (digit && index < length - 1) {
      focusInput(index + 1);
    }

    // Call onComplete if all digits are filled
    if (code.length === length && onComplete) {
      onComplete(code);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!digits[index] && index > 0) {
        // Move to previous input if current is empty
        focusInput(index - 1);
      } else {
        // Clear current input
        const newDigits = [...digits];
        newDigits[index] = '';
        setDigits(newDigits);
        onChange(newDigits.join(''));
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      focusInput(index - 1);
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      focusInput(index + 1);
    }
  };

  const handlePaste = (startIndex: number, pastedText: string) => {
    const pastedDigits = pastedText.replace(/[^0-9]/g, '').split('');
    const newDigits = [...digits];

    pastedDigits.forEach((digit, i) => {
      const targetIndex = startIndex + i;
      if (targetIndex < length) {
        newDigits[targetIndex] = digit;
      }
    });

    setDigits(newDigits);
    const code = newDigits.join('');
    onChange(code);

    // Focus the next empty input or the last input
    const nextEmptyIndex = newDigits.findIndex((d, i) => i >= startIndex && !d);
    if (nextEmptyIndex !== -1) {
      focusInput(nextEmptyIndex);
    } else {
      focusInput(Math.min(startIndex + pastedDigits.length, length - 1));
    }

    // Call onComplete if all digits are filled
    if (code.length === length && onComplete) {
      onComplete(code);
    }
  };

  const handlePasteEvent = (index: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    handlePaste(index, pastedText);
  };

  return (
    <Group gap="xs" justify="center">
      {Array.from({ length }).map((_, index) => (
        <TextInput
          key={index}
          ref={(el) => (inputRefs.current[index] = el)}
          value={digits[index] || ''}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={(e) => handlePasteEvent(index, e)}
          onFocus={(e) => e.target.select()}
          disabled={disabled}
          maxLength={1}
          styles={{
            input: {
              width: '3rem',
              height: '3.5rem',
              textAlign: 'center',
              fontSize: '1.5rem',
              fontWeight: 'bold',
              fontFamily: 'monospace',
            },
          }}
          classNames={{
            input: 'border-2 border-gray-300 focus:border-blue-500 rounded-lg',
          }}
        />
      ))}
    </Group>
  );
}

