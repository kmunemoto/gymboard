
-- Create messages table
CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_id UUID NOT NULL,
  receiver_id UUID NOT NULL,
  content TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Users can view messages they sent or received
CREATE POLICY "Users can view own messages"
ON public.messages FOR SELECT
TO authenticated
USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- Trainers can view all messages
CREATE POLICY "Trainers can view all messages"
ON public.messages FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'trainer'::app_role));

-- Users can insert messages as sender
CREATE POLICY "Users can send messages"
ON public.messages FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = sender_id);

-- Receiver or trainer can mark as read
CREATE POLICY "Receiver can update read status"
ON public.messages FOR UPDATE
TO authenticated
USING (auth.uid() = receiver_id OR has_role(auth.uid(), 'trainer'::app_role));

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
