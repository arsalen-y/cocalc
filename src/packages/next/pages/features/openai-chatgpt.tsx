/*
 *  This file is part of CoCalc: Copyright © 2021 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

import { Layout } from "antd";

import OpenAIAvatar from "@cocalc/frontend/components/openai-avatar";
import Content from "components/landing/content";
import Footer from "components/landing/footer";
import Head from "components/landing/head";
import Header from "components/landing/header";
import Info from "components/landing/info";
import Pitch from "components/landing/pitch";
import SignIn from "components/landing/sign-in";
import { Paragraph, Title, Text } from "components/misc";
import A from "components/misc/A";
import { Customize } from "lib/customize";
import withCustomize from "lib/with-customize";
import ChatGptInChatroom from "/public/features/chatgpt-fix-code.png";
import ChatGptGenerateCode from "/public/features/chatgpt-generate-code.png";
import ChatGptGenerateCodeRun from "/public/features/chatgpt-generate-code-run.png";
import Image from "components/landing/image";
import ChatGPTCPPInterface from "/public/features/chatgpt-cpp-interface.png";
import ChatGPTCPPRun from "/public/features/chatgpt-cpp-running.png";

const component = "OpenAI's ChatGPT";
const title = `OpenAI ChatGPT`;

export default function ChatGPT({ customize }) {
  return (
    <Customize value={customize}>
      <Head title={title} />
      <Layout>
        <Header page="features" subPage="openai-chatgpt" />
        <Layout.Content>
          <Content
            landing
            startup={component}
            logo={<OpenAIAvatar size={128} />}
            title={title}
            subtitleBelow={true}
            subtitle={
              <>
                <div>
                  <A href={"https://openai.com/"}>{component}</A> is a large
                  language model capable of generating human-like responses and
                  code based on various prompts and queries. CoCalc integrates
                  ChatGPT as a virtual assistant to provide coding help, error
                  fixing, and code generation, making it easier for users to
                  work with various programming languages.
                </div>
              </>
            }
            image={ChatGPTCPPInterface}
            alt={"ChatGPT in CoCalc"}
            caption={"ChatGPT in a CoCalc"}
          />

          <Pitch
            col1={
              <>
                <Title level={2}>Help with coding</Title>
                <Paragraph>
                  <li>ChatGPT understands most programming languages.</li>
                  <li>Based on your input, it can generate code for you.</li>
                  <li>
                    It is able to interpret error messages and give suggestions.
                  </li>
                  <li>Fixes code, by modifying a snippet of code of yours.</li>
                </Paragraph>
              </>
            }
            col2={
              <>
                <Title level={2}>Virtual assistant</Title>
                <Paragraph>
                  <li>
                    ChatGPT provides virtual assistance, helping you fix bugs,
                    and understand and write code. It supports all programming
                    languages and is easy to use with the click of a button.
                  </li>
                  <li>You can also ask it to add documentation to code.</li>
                  <li>
                    Complete code based on existing code and an instruction.
                  </li>
                </Paragraph>
              </>
            }
          />

          <Info.Heading
            description={
              <>
                There are various places where ChatGPT appears in CoCalc, as
                illustrated below and{" "}
                <A href="https://doc.cocalc.com/chatgpt.html">
                  explained in the docs
                </A>
                .
              </>
            }
          >
            Integrations of ChatGPT in CoCalc
          </Info.Heading>

          <ChatGPTFixError />

          <Info
            title={
              <A href="https://doc.cocalc.com/chatgpt.html#chatgpt-in-chat-rooms-and-side-chat">
                Mention @chatgpt in any Chatroom in CoCalc
              </A>
            }
            icon="comment"
            image={ChatGptGenerateCode}
            anchor="a-chatgpt-generate"
            alt="ChatGPT generates code in a chatroom"
          >
            <Paragraph>
              Here, a user learning <A href="https://pytorch.org/">PyTorch</A>{" "}
              asks ChatGPT by{" "}
              <A href="https://doc.cocalc.com/chat.html#mentions">mentioning</A>{" "}
              <Text code>@chatgpt</Text> in a{" "}
              <A href="https://doc.cocalc.com/chat.html#side-chat">Side Chat</A>
              . The prompt is:
            </Paragraph>
            <Paragraph>
              <blockquote>multiply two random matrices in pytorch</blockquote>
            </Paragraph>
            <Paragraph>
              Sure enough, ChatGPT generates code that does exactly that. By
              copying that simple example into your Jupyter Notebook, the user
              can immediately run it and continue to play around with it.
            </Paragraph>
            <Paragraph>
              <Image
                src={ChatGptGenerateCodeRun}
                alt="Running code snippet generated by ChatGPT"
              />
            </Paragraph>
          </Info>

          <Info
            title={"Generating Code"}
            icon="pen"
            image={ChatGPTCPPInterface}
            anchor="a-chatgpt-cpp"
            alt="ChatGPT generates c++ code in a file"
            narrow
          >
            <Paragraph>
              ChatGPT can also help you with plain text source code files. In
              the example on the left, an empty <Text code>learning.cpp</Text>{" "}
              C++ file is shown. The ChatGPT dialog shows the prompt to generate
              a simple code example:
            </Paragraph>
            <Paragraph>
              <blockquote>
                generate a short c++ program, which counts from 0 to 100 and
                prints each line, which is divisible by 7
              </blockquote>
            </Paragraph>
            <Paragraph>
              This is all it needs to generate a complete C++ program. Use the{" "}
              <A href="https://doc.cocalc.com/frame-editor.html">
                Frame Editor's
              </A>{" "}
              <A href="/features/terminal">Terminal</A> to compile and run it on
              the spot!
            </Paragraph>
            <Paragraph>
              <Image
                src={ChatGPTCPPRun}
                alt="Running code snippet generated by ChatGPT"
              />
            </Paragraph>
          </Info>

          <SignIn startup={component} />
        </Layout.Content>
        <Footer />
      </Layout>
    </Customize>
  );
}

export async function getServerSideProps(context) {
  return await withCustomize({ context });
}

export function ChatGPTFixError({ embedded = false }: { embedded?: boolean }) {
  const title = embedded ? "ChatGPT fixes code" : "Help fixing code";

  // a general intro about what this is, if this block is embeded on another page
  function intro() {
    if (!embedded) return null;
    return (
      <Paragraph>
        Use the power of <A href="/features/openai-chatgpt">ChatGPT</A> to help
        fixing errors or to generate code.
      </Paragraph>
    );
  }

  return (
    <Info
      title={title}
      icon="bug"
      image={ChatGptInChatroom}
      anchor="a-chatgpt-notebook"
      alt="ChatGPT explains an error message and fixes code"
      wide
    >
      {intro()}
      <Paragraph>
        In this example, a code cell in a{" "}
        <A href="/features/jupyter-notebook">Jupyter Notebook</A> returned an
        error. Clicking the botton to explain the error message creates a
        message addressed to ChatGPT, which asks for help and to fix the code.
      </Paragraph>
      <Paragraph>
        With enough context – the few lines of input code and the lines in the
        stacktrace – it will attempt to fix the code for you. The fix might not
        be perfect, but it can be a good starting point.
      </Paragraph>
    </Info>
  );
}
