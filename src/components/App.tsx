import React, { useEffect } from 'react';
import {
  MantineProvider,
  AppShell,
  Group,
  Title,
  Text,
  Container,
  Box,
  Anchor,
  Stack,
  Badge
} from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import { IconBrandGithub, IconHeart, IconAlertCircle } from '@tabler/icons-react';
import LinkCreator from './LinkCreator';

export default function App() {
  useEffect(() => {
    // Check for expired link parameters in URL
    const urlParams = new URLSearchParams(window.location.search);
    const isExpired = urlParams.get('expired') === 'true';
    const expiredKey = urlParams.get('key');

    if (isExpired) {
      // Show notification for expired/non-existent link
      notifications.show({
        title: 'Link Not Found',
        message: expiredKey
          ? `The link "/${expiredKey}" may have expired or doesn't exist.`
          : 'The link you tried to access may have expired or doesn\'t exist.',
        color: 'orange',
        icon: <IconAlertCircle size={16} />,
        autoClose: 8000,
      });

      // Clean up URL parameters
      const newUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    }
  }, []);

  return (
    <MantineProvider defaultColorScheme="light" theme={{ fontFamily: 'Inter, system-ui, sans-serif', primaryColor: 'blue' }}>
      <Notifications position="top-right" />
      <AppShell
        header={{ height: 70 }}
        footer={{ height: 60 }}
        padding="md"
        className="min-h-screen bg-white"
      >
        <AppShell.Header className="border-b border-gray-200 bg-white">
          <Group h="100%" px="lg" justify="space-between">
            <Group gap="md" align="center">
              <Box className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                  <Text c="white" fw={800} size="sm">S</Text>
                </div>
                <Title order={2} fw={800} className="gradient-text">
                  ShareThis.site
                </Title>
              </Box>
              <Badge variant="light" color="blue" size="sm" className="hidden sm:block">
                Beta
              </Badge>
            </Group>
            <Group gap="md">
              <Anchor
                href="https://github.com/chark1es/sharethis"
                target="_blank"
                className="text-gray-600 hover:text-gray-900 transition-colors duration-200"
              >
                <IconBrandGithub size={20} />
              </Anchor>
            </Group>
          </Group>
        </AppShell.Header>

        <AppShell.Main className="flex flex-col">
          <Container size="md" className="flex-1">
            <Box ta="center" py="xl" className="animate-fade-in">
              <Stack gap="lg" align="center">
                <Box>
                  <Title
                    order={1}
                    fw={900}
                    size="3rem"
                    className="mb-2 leading-tight"
                  >
                    Simple, temporary links
                  </Title>
                  <Text
                    size="xl"
                    c="dimmed"
                    maw={600}
                    mx="auto"
                    className="leading-relaxed"
                  >
                    Create beautiful short-lived links like{' '}
                    <code className="bg-gray-100 px-2 py-1 rounded text-blue-600 font-mono">
                      /tell
                    </code>{' '}
                    or{' '}
                    <code className="bg-gray-100 px-2 py-1 rounded text-purple-600 font-mono">
                      /generate
                    </code>
                    . No account needed, just paste and share.
                  </Text>
                </Box>

                <Group gap="md" className="mt-4">
                  <Badge variant="light" color="green" size="lg">
                    🔒 Secure
                  </Badge>
                  <Badge variant="light" color="blue" size="lg">
                    ⚡ Fast
                  </Badge>
                  <Badge variant="light" color="purple" size="lg">
                    🎯 Simple
                  </Badge>
                </Group>
              </Stack>
            </Box>

            <Box mt="xl" className="animate-slide-up">
              <LinkCreator />
            </Box>
          </Container>
        </AppShell.Main>

        <AppShell.Footer className="border-t border-gray-200 bg-white">
          <Group h="100%" px="lg" justify="space-between" align="center">
            <Text size="sm" c="dimmed">
              © ${new Date().getFullYear()} ShareThis.site - Temporary link shortener
            </Text>
            <Group gap="xs" align="center">
              <Text size="sm" c="dimmed">
                Made with
              </Text>
              <IconHeart size={14} className="text-red-500" />
              <Text size="sm" c="dimmed">
                for the web
              </Text>
            </Group>
          </Group>
        </AppShell.Footer>
      </AppShell>
    </MantineProvider>
  );
}

